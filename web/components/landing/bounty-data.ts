export type BountyTheme = "lime" | "red" | "cyan" | "orange" | "violet";

export type Bounty = {
  id: string;
  repo: string;
  description: string;
  reward: number;
  theme: BountyTheme;
};

export const BOUNTY_POOL: Bounty[] = [
  // Page 0
  {
    id: "b1",
    repo: "semswitch-inc/jsdiff-demo",
    description: "Whitespace parsing logic & AST failures",
    reward: 50,
    theme: "lime",
  },
  {
    id: "b2",
    repo: "indie-todos-app/core",
    description: "Auth state drops on network transitions",
    reward: 100,
    theme: "red",
  },
  {
    id: "b3",
    repo: "acme-corp/webhook-sync",
    description: "Stripe webhook race conditions",
    reward: 75,
    theme: "cyan",
  },
  // Page 1
  {
    id: "b4",
    repo: "startup-inc/mobile-nav",
    description: "Gesture swipe conflict on iOS Safari",
    reward: 60,
    theme: "orange",
  },
  {
    id: "b5",
    repo: "crypto-dash/charts",
    description: "Canvas rendering memory leak on zoom",
    reward: 120,
    theme: "violet",
  },
  {
    id: "b6",
    repo: "open-source/router",
    description: "Nested dynamic routes 404 incorrectly",
    reward: 85,
    theme: "lime",
  },
  // Page 2
  {
    id: "b7",
    repo: "fintech-app/payments",
    description: "Decimal rounding error in currency conversion",
    reward: 150,
    theme: "red",
  },
  {
    id: "b8",
    repo: "social-feed/scroll",
    description: "Infinite scroll pagination duplicate keys",
    reward: 40,
    theme: "cyan",
  },
  {
    id: "b9",
    repo: "e-commerce/cart",
    description: "Cart state out of sync across multiple tabs",
    reward: 90,
    theme: "orange",
  },
  // Page 3
  {
    id: "b10",
    repo: "devtools-cli/parser",
    description: "Incorrect YAML parsing on multiline strings",
    reward: 55,
    theme: "violet",
  },
  {
    id: "b11",
    repo: "health-tracker/sync",
    description: "HealthKit background sync timeout",
    reward: 110,
    theme: "red",
  },
  {
    id: "b12",
    repo: "analytics-dashboard/export",
    description: "CSV export truncates row data over 10k limits",
    reward: 70,
    theme: "lime",
  },
];
