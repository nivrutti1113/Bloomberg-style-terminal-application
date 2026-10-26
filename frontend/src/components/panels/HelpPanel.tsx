"use client";

import React from "react";

export const HelpPanel: React.FC = () => {
  return (
    <div className="w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none p-4 overflow-y-auto space-y-4">
      {/* Title */}
      <div className="border-b border-[#2A2A2A] pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold text-[13px]">TERMINAL SYSTEM HELP &amp; DIRECTORY</span>
        </div>
        <span className="text-[#666666] text-[10px]">BLOOMBERG-STYLE COMMAND SYNTAX</span>
      </div>

      {/* Function Commands Table */}
      <div className="space-y-2">
        <div className="text-[#FFB000] font-bold text-[11px]">CORE PANEL FUNCTIONS</div>
        <div className="border border-[#2A2A2A] bg-[#000000]">
          <div className="grid grid-cols-12 bg-[#141414] border-b border-[#2A2A2A] text-[#9A9A9A] text-[10px] p-1.5 font-bold">
            <div className="col-span-2">COMMAND</div>
            <div className="col-span-2">FUNCTION</div>
            <div className="col-span-3">DESCRIPTION</div>
            <div className="col-span-5">EXAMPLE SYNTAX</div>
          </div>

          <div className="divide-y divide-[#1A1A1A] text-[10px]">
            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">WL</div>
              <div className="col-span-2 text-white">Watchlist</div>
              <div className="col-span-3 text-[#9A9A9A]">Multi-asset quotes &amp; sparklines</div>
              <div className="col-span-5 text-[#2D9CDB]">WL</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">&lt;SYM&gt; GP</div>
              <div className="col-span-2 text-white">Price Chart</div>
              <div className="col-span-3 text-[#9A9A9A]">TradingView candles &amp; indicators</div>
              <div className="col-span-5 text-[#2D9CDB]">BTC GP, ETH GP, SOL GP</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">&lt;SYM&gt; OB</div>
              <div className="col-span-2 text-white">Order Book</div>
              <div className="col-span-3 text-[#9A9A9A]">20-level depth ladder with spread</div>
              <div className="col-span-5 text-[#2D9CDB]">BTC OB, SOL OB</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">&lt;SYM&gt; TS</div>
              <div className="col-span-2 text-white">Time &amp; Sales</div>
              <div className="col-span-3 text-[#9A9A9A]">Live trade tape &amp; size alerts</div>
              <div className="col-span-5 text-[#2D9CDB]">BTC TS, ETH TS</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">&lt;SYM&gt; VOL</div>
              <div className="col-span-2 text-white">HAR Volatility</div>
              <div className="col-span-3 text-[#9A9A9A]">HAR-RV realized vol forecast (1d, 5d, 22d)</div>
              <div className="col-span-5 text-[#2D9CDB]">BTC VOL, ETH VOL</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">&lt;SYM&gt; BT</div>
              <div className="col-span-2 text-white">Vol Target BT</div>
              <div className="col-span-3 text-[#9A9A9A]">Backtest equity curve &amp; Sharpe ratio</div>
              <div className="col-span-5 text-[#2D9CDB]">BTC BT</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">ADD &lt;SYM&gt;</div>
              <div className="col-span-2 text-white">Add Watchlist</div>
              <div className="col-span-3 text-[#9A9A9A]">Add asset symbol to live watchlist</div>
              <div className="col-span-5 text-[#2D9CDB]">ADD SOLUSDT, ADD DOGE</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">DEL &lt;SYM&gt;</div>
              <div className="col-span-2 text-white">Remove Watchlist</div>
              <div className="col-span-3 text-[#9A9A9A]">Remove asset symbol from watchlist</div>
              <div className="col-span-5 text-[#2D9CDB]">DEL SOLUSDT</div>
            </div>

            <div className="grid grid-cols-12 p-1.5 hover:bg-[#141414]">
              <div className="col-span-2 text-[#FFB000] font-bold">METRICS</div>
              <div className="col-span-2 text-white">Telemetry</div>
              <div className="col-span-3 text-[#9A9A9A]">Throughput, latencies, websocket health</div>
              <div className="col-span-5 text-[#2D9CDB]">METRICS</div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Table */}
      <div className="space-y-2">
        <div className="text-[#FFB000] font-bold text-[11px]">KEYBOARD SHORTCUTS</div>
        <div className="grid grid-cols-2 gap-3 text-[10px]">
          <div className="border border-[#2A2A2A] bg-[#000000] p-2 space-y-1">
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#FFB000] font-bold">/ or Ctrl+K</span>
              <span className="text-white">Focus Command Bar</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#FFB000] font-bold">Esc</span>
              <span className="text-white">Close focused panel / blur</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#FFB000] font-bold">Up / Down Arrow</span>
              <span className="text-white">Command history navigation</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-[#FFB000] font-bold">Enter</span>
              <span className="text-white">Execute command</span>
            </div>
          </div>

          <div className="border border-[#2A2A2A] bg-[#000000] p-2 space-y-1">
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#00D26A] font-bold">F1</span>
              <span className="text-white">Open Watchlist (WL)</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#00D26A] font-bold">F2</span>
              <span className="text-white">Open Price Chart (GP)</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-[#1A1A1A]">
              <span className="text-[#00D26A] font-bold">F3</span>
              <span className="text-white">Open Order Book (OB)</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-[#00D26A] font-bold">F4</span>
              <span className="text-white">Open Time &amp; Sales (TS)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
