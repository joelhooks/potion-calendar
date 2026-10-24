import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: [
      {
        test: {
          environment: "node",
          exclude: ["test/**/*.dom.test.ts"],
          include: ["test/**/*.test.ts"],
          name: "node",
        },
      },
      {
        test: {
          environment: "jsdom",
          include: ["test/**/*.dom.test.ts"],
          name: "jsdom",
        },
      },
    ],
  },
});
