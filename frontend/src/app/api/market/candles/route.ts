import { NextResponse } from "next/server";

const SYMBOL_MAP: Record<string, string> = {
  NIFTY50: "^NSEI",
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
  BSEX: "^BSESN",
};

const TIMEFRAME_MAP: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "1h", range: "1mo" },
  "1d": { interval: "1d", range: "1y" },
};

function resolveTicker(sym: string): string {
  const upper = sym.toUpperCase().trim();
  if (SYMBOL_MAP[upper]) {
    return SYMBOL_MAP[upper];
  }
  if (upper.endsWith(".NS") || upper.endsWith(".BO") || upper.startsWith("^")) {
    return upper;
  }
  return `${upper}.NS`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") || "RELIANCE";
    const tf = searchParams.get("tf") || "1m";
    const limit = Math.min(Number(searchParams.get("limit") || 180), 500);

    const ticker = resolveTicker(symbol);
    const tfConfig = TIMEFRAME_MAP[tf] || TIMEFRAME_MAP["1m"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${tfConfig.interval}&range=${tfConfig.range}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      next: { revalidate: 5 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo Finance error: HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return NextResponse.json(
        { error: "No chart data returned" },
        { status: 404 }
      );
    }

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    const candles: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      if (o !== null && c !== null && h !== null && l !== null) {
        candles.push({
          time: timestamps[i],
          open: Number(o.toFixed(2)),
          high: Number(h.toFixed(2)),
          low: Number(l.toFixed(2)),
          close: Number(c.toFixed(2)),
          volume: Number(volumes[i] || 0),
        });
      }
    }

    // Sort by time ascending and slice to limit
    candles.sort((a, b) => a.time - b.time);
    const sliced = limit > 0 ? candles.slice(-limit) : candles;

    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      timeframe: tf,
      count: sliced.length,
      candles: sliced,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch candles: ${String(err)}` },
      { status: 500 }
    );
  }
}
