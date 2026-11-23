import { NextResponse } from "next/server";

const SYMBOL_MAP: Record<string, string> = {
  NIFTY50: "^NSEI",
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
  BSEX: "^BSESN",
};

const DEFAULT_INDIAN_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "BHARTIARTL",
  "NIFTY50",
  "BANKNIFTY",
  "SENSEX",
];

function resolveTicker(sym: string): { ticker: string; venue: "NSE" | "BSE" } {
  const upper = sym.toUpperCase().trim();
  if (SYMBOL_MAP[upper]) {
    const isBse = upper === "SENSEX" || upper === "BSEX";
    return { ticker: SYMBOL_MAP[upper], venue: isBse ? "BSE" : "NSE" };
  }

  if (upper.endsWith(".BO") || upper.startsWith("^BSE")) {
    return { ticker: upper, venue: "BSE" };
  }

  if (upper.endsWith(".NS") || upper.startsWith("^")) {
    return { ticker: upper, venue: "NSE" };
  }

  return { ticker: `${upper}.NS`, venue: "NSE" };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get("symbols");
    const requestedSymbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : DEFAULT_INDIAN_SYMBOLS;

    const results: Record<string, unknown> = {};

    await Promise.all(
      requestedSymbols.map(async (sym) => {
        const { ticker, venue } = resolveTicker(sym);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;

        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
            next: { revalidate: 3 }, // Cache for 3 seconds
          });

          if (!res.ok) return;

          const data = await res.json();
          const result = data?.chart?.result?.[0];
          if (!result) return;

          const meta = result.meta || {};
          const lastPrice = Number(meta.regularMarketPrice ?? 0);
          if (lastPrice <= 0) return;

          const prevClose = Number(
            meta.chartPreviousClose || meta.previousClose || lastPrice
          );
          const change24h = Number((lastPrice - prevClose).toFixed(2));
          const changePct24h =
            prevClose > 0
              ? Number(((change24h / prevClose) * 100).toFixed(2))
              : 0;

          const high24h = Number(meta.regularMarketDayHigh ?? lastPrice);
          const low24h = Number(meta.regularMarketDayLow ?? lastPrice);
          const volume24h = Number(meta.regularMarketVolume ?? 0);
          const marketTimeMs = Number(meta.regularMarketTime ?? 0) * 1000;

          results[sym] = {
            symbol: sym,
            venue,
            price: lastPrice,
            qty: 10,
            change_24h: change24h,
            change_pct_24h: changePct24h,
            high_24h: high24h,
            low_24h: low24h,
            volume_24h: volume24h,
            open_price: prevClose,
            exch_ts_ms: marketTimeMs || Date.now(),
            recv_ts_ms: Date.now(),
            long_name: meta.longName || meta.shortName || sym,
          };
        } catch {
          // Ignore individual fetch failure
        }
      })
    );

    return NextResponse.json({
      status: "SUCCESS",
      count: Object.keys(results).length,
      data: results,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "ERROR", message: String(err) },
      { status: 500 }
    );
  }
}
