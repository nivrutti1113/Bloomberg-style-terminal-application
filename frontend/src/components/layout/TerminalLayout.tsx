"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import {
  Layout,
  Model,
  TabNode,
  Actions,
  IJsonModel,
  DockLocation,
} from "flexlayout-react";
import "flexlayout-react/style/dark.css";

import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { OrderBookPanel } from "@/components/panels/OrderBookPanel";
import { TimeAndSalesPanel } from "@/components/panels/TimeAndSalesPanel";
import { AnalyticsPanel } from "@/components/panels/AnalyticsPanel";
import { MetricsPanel } from "@/components/panels/MetricsPanel";
import { HelpPanel } from "@/components/panels/HelpPanel";
import { useTerminalStore } from "@/store/terminalStore";

const STORAGE_KEY = "FINEVERS_TERMINAL_LAYOUT_V3";

const defaultLayoutJson: IJsonModel = {
  global: {
    tabEnableClose: true,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableTabStrip: true,
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 38,
        id: "tabset_left",
        children: [
          {
            type: "tab",
            name: "WATCHLIST (WL)",
            component: "watchlist",
            id: "panel_watchlist",
            enableClose: false,
          },
        ],
      },
      {
        type: "row",
        weight: 62,
        children: [
          {
            type: "tabset",
            weight: 55,
            id: "tabset_top_right",
            children: [
              {
                type: "tab",
                name: "BTC GP (CHART)",
                component: "chart",
                id: "panel_chart_BTCUSDT",
                config: { symbol: "BTCUSDT" },
              },
              {
                type: "tab",
                name: "BTC OB (ORDER BOOK)",
                component: "orderbook",
                id: "panel_orderbook_BTCUSDT",
                config: { symbol: "BTCUSDT" },
              },
              {
                type: "tab",
                name: "BTC VOL (HAR)",
                component: "analytics",
                id: "panel_analytics_VOL_BTCUSDT",
                config: { symbol: "BTCUSDT", defaultTab: "VOL" },
              },
              {
                type: "tab",
                name: "BTC BT (BACKTEST)",
                component: "analytics",
                id: "panel_analytics_BT_BTCUSDT",
                config: { symbol: "BTCUSDT", defaultTab: "BT" },
              },
            ],
          },
          {
            type: "tabset",
            weight: 45,
            id: "tabset_bottom_right",
            children: [
              {
                type: "tab",
                name: "BTC TS (TIME & SALES)",
                component: "trades",
                id: "panel_trades_BTCUSDT",
                config: { symbol: "BTCUSDT" },
              },
              {
                type: "tab",
                name: "TELEMETRY (METRICS)",
                component: "metrics",
                id: "panel_metrics",
              },
              {
                type: "tab",
                name: "HELP (CATALOG)",
                component: "help",
                id: "panel_help",
              },
            ],
          },
        ],
      },
    ],
  },
};

export interface TerminalLayoutRef {
  openOrFocusTab: (component: string, symbol?: string, title?: string, panelFunction?: string) => void;
  closeActiveTab: () => void;
  resetLayout: () => void;
}

export const TerminalLayout = forwardRef<TerminalLayoutRef, object>((_, ref) => {
  const [model, setModel] = useState<Model | null>(null);
  const { setActiveSymbol, activeSymbol } = useTerminalStore();
  const focusedNodeIdRef = useRef<string | null>(null);

  // Initialize model from localStorage or default
  useEffect(() => {
    let initialModel: Model;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        initialModel = Model.fromJson(JSON.parse(saved));
      } else {
        initialModel = Model.fromJson(defaultLayoutJson);
      }
    } catch {
      initialModel = Model.fromJson(defaultLayoutJson);
    }

    setModel(initialModel);
  }, []);

  // Save model changes to localStorage
  const handleModelChange = useCallback((m: Model) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m.toJson()));
    } catch {
      // ignore quota errors
    }
  }, []);

  const openOrFocusTab = useCallback(
    (component: string, symbol?: string, title?: string, panelFunction?: string) => {
      if (!model) return;

      const sym = (symbol || activeSymbol).toUpperCase();
      const cleanTicker = sym.replace(/USDT$/, "");
      if (symbol) {
        setActiveSymbol(sym);
      }

      let tabId = `panel_${component}`;
      let tabTitle = title || "";

      if (component === "chart") {
        tabId = `panel_chart_${sym}`;
        tabTitle = title || `${cleanTicker} GP (CHART)`;
      } else if (component === "orderbook") {
        tabId = `panel_orderbook_${sym}`;
        tabTitle = title || `${cleanTicker} OB (ORDER BOOK)`;
      } else if (component === "trades") {
        tabId = `panel_trades_${sym}`;
        tabTitle = title || `${cleanTicker} TS (TIME & SALES)`;
      } else if (component === "analytics") {
        const subType = panelFunction === "BT" ? "BT" : "VOL";
        tabId = `panel_analytics_${subType}_${sym}`;
        tabTitle = title || (subType === "BT" ? `${cleanTicker} BT (BACKTEST)` : `${cleanTicker} VOL (HAR)`);
      } else if (component === "watchlist") {
        tabId = "panel_watchlist";
        tabTitle = "WATCHLIST (WL)";
      } else if (component === "metrics") {
        tabId = "panel_metrics";
        tabTitle = "TELEMETRY (METRICS)";
      } else if (component === "help") {
        tabId = "panel_help";
        tabTitle = "HELP (CATALOG)";
      }

      // Check if this exact tab already exists in layout
      const existing = model.getNodeById(tabId);
      if (existing) {
        model.doAction(Actions.selectTab(tabId));
        return;
      }

      // Non-symbol singletons (WL, METRICS, HELP) check generic ID
      if (component === "watchlist" || component === "metrics" || component === "help") {
        const generic = model.getNodeById(`panel_${component}`);
        if (generic) {
          model.doAction(Actions.selectTab(`panel_${component}`));
          return;
        }
      }

      // Pick target tabset
      const preferredTabset =
        component === "watchlist"
          ? "tabset_left"
          : component === "trades" || component === "metrics" || component === "help"
          ? "tabset_bottom_right"
          : "tabset_top_right";

      let targetTabsetId = preferredTabset;
      if (!model.getNodeById(targetTabsetId)) {
        let foundTabset: string | null = null;
        model.visitNodes((n) => {
          if (!foundTabset && n.getType() === "tabset") {
            foundTabset = n.getId();
          }
        });
        targetTabsetId = foundTabset || "tabset_top_right";
      }

      const defaultTab = panelFunction === "BT" ? "BT" : "VOL";

      model.doAction(
        Actions.addNode(
          {
            type: "tab",
            id: tabId,
            name: tabTitle,
            component,
            config: {
              symbol: sym,
              panelFunction,
              defaultTab,
            },
            enableClose: component !== "watchlist",
          },
          targetTabsetId,
          DockLocation.CENTER,
          -1
        )
      );

      // Focus the newly added tab
      model.doAction(Actions.selectTab(tabId));
    },
    [model, activeSymbol, setActiveSymbol]
  );

  const closeActiveTab = useCallback(() => {
    if (!model || !focusedNodeIdRef.current) return;
    const node = model.getNodeById(focusedNodeIdRef.current);
    if (node instanceof TabNode && node.isEnableClose()) {
      model.doAction(Actions.deleteTab(focusedNodeIdRef.current));
    }
  }, [model]);

  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setModel(Model.fromJson(defaultLayoutJson));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      openOrFocusTab,
      closeActiveTab,
      resetLayout,
    }),
    [openOrFocusTab, closeActiveTab, resetLayout]
  );

  // Keyboard shortcut listener for F1-F8 and Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      switch (e.key) {
        case "F1":
          e.preventDefault();
          openOrFocusTab("watchlist", undefined, "WATCHLIST (WL)", "WL");
          break;
        case "F2":
          e.preventDefault();
          openOrFocusTab("chart", activeSymbol, `${activeSymbol.replace(/USDT$/, "")} GP (CHART)`, "GP");
          break;
        case "F3":
          e.preventDefault();
          openOrFocusTab("orderbook", activeSymbol, `${activeSymbol.replace(/USDT$/, "")} OB (ORDER BOOK)`, "OB");
          break;
        case "F4":
          e.preventDefault();
          openOrFocusTab("trades", activeSymbol, `${activeSymbol.replace(/USDT$/, "")} TS (TIME & SALES)`, "TS");
          break;
        case "F5":
          e.preventDefault();
          openOrFocusTab("analytics", activeSymbol, `${activeSymbol.replace(/USDT$/, "")} VOL (HAR)`, "VOL");
          break;
        case "F6":
          e.preventDefault();
          openOrFocusTab("analytics", activeSymbol, `${activeSymbol.replace(/USDT$/, "")} BT (BACKTEST)`, "BT");
          break;
        case "F7":
          e.preventDefault();
          openOrFocusTab("metrics", undefined, "TELEMETRY (METRICS)", "METRICS");
          break;
        case "F8":
          e.preventDefault();
          openOrFocusTab("help", undefined, "HELP (CATALOG)", "HELP");
          break;
        case "Escape":
          closeActiveTab();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openOrFocusTab, closeActiveTab, activeSymbol]);

  // Tab factory
  const factory = (node: TabNode) => {
    const component = node.getComponent();
    const config = node.getConfig() as
      | { symbol?: string; defaultTab?: "VOL" | "BT"; panelFunction?: string }
      | undefined;
    const sym = config?.symbol || activeSymbol;

    switch (component) {
      case "watchlist":
        return <WatchlistPanel />;
      case "chart":
        return <ChartPanel symbol={sym} />;
      case "orderbook":
        return <OrderBookPanel symbol={sym} />;
      case "trades":
        return <TimeAndSalesPanel symbol={sym} />;
      case "analytics":
        return <AnalyticsPanel symbol={sym} defaultTab={config?.defaultTab || "VOL"} />;
      case "metrics":
        return <MetricsPanel />;
      case "help":
        return <HelpPanel />;
      default:
        return (
          <div className="p-4 text-[#FF3B30] font-mono">
            UNKNOWN COMPONENT: {component}
          </div>
        );
    }
  };

  if (!model) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#000000] text-[#FFB000] font-mono text-[12px]">
        INITIALIZING TERMINAL ENGINE...
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-[#000000]">
      <Layout
        model={model}
        factory={factory}
        onModelChange={handleModelChange}
      />
    </div>
  );
});

TerminalLayout.displayName = "TerminalLayout";
