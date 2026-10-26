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

const STORAGE_KEY = "FINEVERS_TERMINAL_LAYOUT_V1";

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
                id: "panel_chart",
              },
              {
                type: "tab",
                name: "BTC OB (ORDER BOOK)",
                component: "orderbook",
                id: "panel_orderbook",
              },
              {
                type: "tab",
                name: "BTC VOL (ANALYTICS)",
                component: "analytics",
                id: "panel_analytics",
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
                id: "panel_trades",
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
  openOrFocusTab: (component: string, symbol?: string, title?: string) => void;
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
    (component: string, symbol?: string, title?: string) => {
      if (!model) return;

      const sym = symbol || activeSymbol;
      if (symbol) {
        setActiveSymbol(symbol);
      }

      const tabTitle = title || (symbol ? `${sym} ${component.toUpperCase()}` : component.toUpperCase());
      const tabId = `panel_${component}_${sym}`;

      // Check if node already exists
      const existing = model.getNodeById(tabId);
      if (existing) {
        model.doAction(Actions.selectTab(tabId));
        return;
      }

      // Check generic panel id
      const generic = model.getNodeById(`panel_${component}`);
      if (generic) {
        model.doAction(Actions.selectTab(`panel_${component}`));
        return;
      }

      // Pick target tabset
      const targetTabset =
        component === "watchlist"
          ? "tabset_left"
          : component === "trades" || component === "metrics" || component === "help"
          ? "tabset_bottom_right"
          : "tabset_top_right";

      model.doAction(
        Actions.addNode(
          {
            type: "tab",
            id: tabId,
            name: tabTitle,
            component,
            config: { symbol: sym },
          },
          targetTabset,
          DockLocation.CENTER,
          -1
        )
      );
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
          openOrFocusTab("watchlist", undefined, "WATCHLIST (WL)");
          break;
        case "F2":
          e.preventDefault();
          openOrFocusTab("chart", activeSymbol, `${activeSymbol} GP (CHART)`);
          break;
        case "F3":
          e.preventDefault();
          openOrFocusTab("orderbook", activeSymbol, `${activeSymbol} OB (ORDER BOOK)`);
          break;
        case "F4":
          e.preventDefault();
          openOrFocusTab("trades", activeSymbol, `${activeSymbol} TS (TIME & SALES)`);
          break;
        case "F5":
          e.preventDefault();
          openOrFocusTab("analytics", activeSymbol, `${activeSymbol} VOL (HAR)`);
          break;
        case "F6":
          e.preventDefault();
          openOrFocusTab("analytics", activeSymbol, `${activeSymbol} BT (BACKTEST)`);
          break;
        case "F7":
          e.preventDefault();
          openOrFocusTab("metrics", undefined, "TELEMETRY (METRICS)");
          break;
        case "F8":
          e.preventDefault();
          openOrFocusTab("help", undefined, "HELP (CATALOG)");
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
    const config = node.getConfig() as { symbol?: string } | undefined;
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
        return <AnalyticsPanel symbol={sym} />;
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
