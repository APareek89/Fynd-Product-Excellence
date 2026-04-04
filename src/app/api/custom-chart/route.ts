import { NextResponse } from "next/server";
import { runHogQL } from "@/lib/posthog-client";
import type { ChartEventEntry, ChartFrequency, ChartPropertyFilter, ChartTimePeriod } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  events: ChartEventEntry[];
  propertyFilters: ChartPropertyFilter[];
  breakdownProperty: string;
  timePeriod: ChartTimePeriod;
  customFrom?: string;
  customTo?: string;
  frequency: ChartFrequency;
};

function buildDateFilter(timePeriod: ChartTimePeriod, customFrom?: string, customTo?: string): { from: string; to: string; sql: string } {
  const now = new Date();
  let from: Date;
  let to: Date = now;

  switch (timePeriod) {
    case "7d":
      from = new Date(now.getTime() - 7 * 86_400_000);
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 86_400_000);
      break;
    case "this-month":
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case "90d":
      from = new Date(now.getTime() - 90 * 86_400_000);
      break;
    case "180d":
      from = new Date(now.getTime() - 180 * 86_400_000);
      break;
    case "custom":
      from = customFrom ? new Date(customFrom) : new Date(now.getTime() - 7 * 86_400_000);
      to = customTo ? new Date(customTo) : now;
      break;
    default:
      from = new Date(now.getTime() - 7 * 86_400_000);
  }

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  return {
    from: fromStr,
    to: toStr,
    sql: `timestamp >= '${fromStr}' AND timestamp < '${toStr}'`,
  };
}

function frequencyToTrunc(freq: ChartFrequency): string {
  switch (freq) {
    case "hour": return "toStartOfHour(timestamp)";
    case "day": return "toStartOfDay(timestamp)";
    case "week": return "toStartOfWeek(timestamp)";
    case "month": return "toStartOfMonth(timestamp)";
    default: return "toStartOfDay(timestamp)";
  }
}

function mathExpr(entry: ChartEventEntry): string {
  switch (entry.mathType) {
    case "unique": return "countDistinct(person_id)";
    case "avg": return entry.mathProperty ? `avg(toFloat64OrNull(properties.${entry.mathProperty}))` : "count()";
    case "sum": return entry.mathProperty ? `sum(toFloat64OrNull(properties.${entry.mathProperty}))` : "count()";
    case "min": return entry.mathProperty ? `min(toFloat64OrNull(properties.${entry.mathProperty}))` : "count()";
    case "max": return entry.mathProperty ? `max(toFloat64OrNull(properties.${entry.mathProperty}))` : "count()";
    default: return "count()";
  }
}

function escSql(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildPropertyWhere(filters: ChartPropertyFilter[]): string {
  return filters
    .filter((f) => f.key && f.value)
    .map((f) => {
      const prop = f.key.startsWith("person.") ? `person.properties.${f.key.slice(7)}` : `properties.${f.key}`;
      switch (f.operator) {
        case "exact": return `${prop} = '${escSql(f.value)}'`;
        case "contains": return `${prop} LIKE '%${escSql(f.value)}%'`;
        case "not_contains": return `${prop} NOT LIKE '%${escSql(f.value)}%'`;
        case "regex": return `match(${prop}, '${escSql(f.value)}')`;
        case "is_set": return `${prop} IS NOT NULL AND ${prop} != ''`;
        case "is_not_set": return `(${prop} IS NULL OR ${prop} = '')`;
        default: return `${prop} = '${escSql(f.value)}'`;
      }
    })
    .join(" AND ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { from: _from, to: _to, sql: dateSql } = buildDateFilter(body.timePeriod, body.customFrom, body.customTo);
    const trunc = frequencyToTrunc(body.frequency);
    const propWhere = buildPropertyWhere(body.propertyFilters);
    const breakdownCol = body.breakdownProperty
      ? `, properties.${body.breakdownProperty} as breakdown`
      : "";
    const breakdownGroup = body.breakdownProperty ? ", breakdown" : "";

    // Build one query per event series
    const allSeries: string[] = [];
    const allData: Record<string, Record<string, number>> = {}; // date -> { series -> value }

    for (const entry of body.events) {
      const seriesName = entry.label || entry.event;
      allSeries.push(seriesName);

      const conditions = [
        dateSql,
        `event = '${escSql(entry.event)}'`,
        propWhere,
      ].filter(Boolean).join(" AND ");

      const sql = `SELECT ${trunc} as period${breakdownCol}, ${mathExpr(entry)} as value
         FROM events
         WHERE ${conditions}
         GROUP BY period${breakdownGroup}
         ORDER BY period ASC`;

      try {
        const rows = await runHogQL<{ period: string; value: number; breakdown?: string }>(
          body.posthogApiKey,
          body.projectId,
          sql,
          body.posthogHost,
        );

        for (const row of rows) {
          const dateKey = typeof row.period === "string"
            ? row.period.slice(0, 10)
            : new Date(row.period as unknown as number).toISOString().slice(0, 10);
          const key = body.breakdownProperty && row.breakdown
            ? `${seriesName} (${row.breakdown})`
            : seriesName;

          if (!allSeries.includes(key) && key !== seriesName) allSeries.push(key);

          if (!allData[dateKey]) allData[dateKey] = {};
          allData[dateKey][key] = Number(row.value) || 0;
        }
      } catch (err) {
        console.error(`Chart query failed for ${entry.event}:`, err);
      }
    }

    // Convert to array of data points
    const dates = Object.keys(allData).sort();
    const data = dates.map((date) => {
      const point: Record<string, string | number> = { date };
      for (const series of allSeries) {
        point[series] = allData[date]?.[series] ?? 0;
      }
      return point;
    });

    // Build display SQL for reference
    const displaySql = body.events
      .map((entry) => {
        const conditions = [dateSql, `event = '${escSql(entry.event)}'`, propWhere].filter(Boolean).join(" AND ");
        return `-- ${entry.label || entry.event}\nSELECT ${trunc} as period, ${mathExpr(entry)} as value\nFROM events\nWHERE ${conditions}\nGROUP BY period\nORDER BY period ASC`;
      })
      .join("\n\n");

    return NextResponse.json({
      title: body.events.map((e) => e.label || e.event).join(" & "),
      data,
      series: allSeries,
      sql: displaySql,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chart query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
