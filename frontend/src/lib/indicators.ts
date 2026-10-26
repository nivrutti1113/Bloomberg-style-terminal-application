/**
 * Technical Indicators for Bloomberg-Style Trading Charts
 * Implements SMA, EMA, Bollinger Bands, and RSI with pure math.
 */

import { UTCTimestamp } from "lightweight-charts";

export interface CandleDataPoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LinePoint {
  time: UTCTimestamp;
  value: number;
}

export interface BollingerBandsResult {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}

/**
 * Simple Moving Average (SMA)
 */
export function calculateSMA(data: CandleDataPoint[], period: number = 20): LinePoint[] {
  if (data.length < period) return [];

  const result: LinePoint[] = [];
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;

    if (i >= period) {
      sum -= data[i - period].close;
    }

    if (i >= period - 1) {
      result.push({
        time: data[i].time,
        value: Number((sum / period).toFixed(4)),
      });
    }
  }

  return result;
}

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(data: CandleDataPoint[], period: number = 50): LinePoint[] {
  if (data.length < period) return [];

  const result: LinePoint[] = [];
  const multiplier = 2 / (period + 1);

  // Initial SMA as starting point
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let prevEMA = sum / period;

  result.push({
    time: data[period - 1].time,
    value: Number(prevEMA.toFixed(4)),
  });

  for (let i = period; i < data.length; i++) {
    const currentClose = data[i].close;
    const currentEMA = (currentClose - prevEMA) * multiplier + prevEMA;
    result.push({
      time: data[i].time,
      value: Number(currentEMA.toFixed(4)),
    });
    prevEMA = currentEMA;
  }

  return result;
}

/**
 * Bollinger Bands (Period=20, StdDev=2)
 */
export function calculateBollingerBands(
  data: CandleDataPoint[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult {
  if (data.length < period) {
    return { upper: [], middle: [], lower: [] };
  }

  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((acc, c) => acc + c.close, 0) / period;
    const variance = slice.reduce((acc, c) => acc + Math.pow(c.close - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const time = data[i].time;
    middle.push({ time, value: Number(mean.toFixed(4)) });
    upper.push({ time, value: Number((mean + stdDevMultiplier * stdDev).toFixed(4)) });
    lower.push({ time, value: Number((mean - stdDevMultiplier * stdDev).toFixed(4)) });
  }

  return { upper, middle, lower };
}

/**
 * Relative Strength Index (RSI, Period=14)
 */
export function calculateRSI(data: CandleDataPoint[], period: number = 14): LinePoint[] {
  if (data.length <= period) return [];

  const result: LinePoint[] = [];
  let gains = 0;
  let losses = 0;

  // First period
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const firstRSI = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRS);

  result.push({
    time: data[period].time,
    value: Number(firstRSI.toFixed(2)),
  });

  // Wilder's Smoothing
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    result.push({
      time: data[i].time,
      value: Number(rsi.toFixed(2)),
    });
  }

  return result;
}
