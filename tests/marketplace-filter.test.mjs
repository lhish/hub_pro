import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../linuxdo-marketplace-badges-free.user.js", import.meta.url), "utf8");
const match = source.match(/const __TEST__ = ([\s\S]*?\n});\n\n\(/);
assert.ok(match, "script should expose test helpers");

const context = {};
vm.createContext(context);
const helpers = vm.runInContext(`(${match[1].trim().replace(/;$/, "")})`, context);

assert.equal(helpers.isFreeChannel({ channelModelPrices: [] }), true);
assert.equal(helpers.isFreeChannel({
  channelModelPrices: [{ price: { items: [{ pricing: { usagePerUnit: "0" } }] } }],
}), true);
assert.equal(helpers.isFreeChannel({
  channelModelPrices: [{ price: { items: [{ pricing: { usagePerUnit: "0.01" } }] } }],
}), false);

const badges = helpers.channelBadges({ type: "openai_responses", usesOfficialBaseURL: true, settings: {} });
assert.equal(badges.length, 2);
assert.equal(badges[0], "Official");
assert.equal(badges[1], "openai_responses");
assert.equal(helpers.badgesMatch(["Official", "openai"], ["openai"]), true);
assert.equal(helpers.badgesMatch(["zhipu"], ["openai", "bailian"]), false);
assert.equal(helpers.channelMatches(
  { type: "zhipu", usesOfficialBaseURL: false, settings: {}, channelModelPrices: [] },
  { badges: ["zhipu"], free: true },
), true);
assert.equal(helpers.channelMatches(
  { type: "openai", usesOfficialBaseURL: true, settings: {}, channelModelPrices: [] },
  { tag: "official", badges: [], free: true },
), true);
assert.equal(helpers.channelMatches(
  { type: "openai", usesOfficialBaseURL: true, settings: {}, channelModelPrices: [] },
  { tag: "third_party", badges: [], free: true },
), false);
assert.equal(helpers.channelMatches(
  { type: "openai", usesOfficialBaseURL: false, settings: { codingAgentMode: "strict" }, channelModelPrices: [] },
  { tag: "strict_client_restricted", badges: [], free: true },
), true);
assert.equal(helpers.channelMatches(
  { type: "zhipu", usesOfficialBaseURL: false, settings: {}, supportedModels: ["glm-4.6", "glm-z1"], channelModelPrices: [] },
  { badges: [], free: true, modelKeyword: "z1" },
), true);
assert.equal(helpers.channelMatches(
  { type: "zhipu", usesOfficialBaseURL: false, settings: {}, supportedModels: ["GLM-4.6", "GLM-Z1"], channelModelPrices: [] },
  { badges: [], free: true, modelKeyword: "glm-z1" },
), true);
assert.equal(helpers.channelMatches(
  { type: "zhipu", usesOfficialBaseURL: false, settings: {}, supportedModels: ["glm-4.6"], channelModelPrices: [] },
  { badges: [], free: true, modelKeyword: "claude" },
), false);

const payload = {
  data: {
    channels: {
      edges: [
        { node: { name: "free openai", type: "openai", usesOfficialBaseURL: false, settings: {}, channelModelPrices: [] } },
        { node: { name: "paid bailian", type: "bailian", usesOfficialBaseURL: false, settings: {}, channelModelPrices: [{ price: { items: [{ pricing: { usagePerUnit: "1" } }] } }] } },
      ],
      totalCount: 2,
    },
  },
};
const filtered = helpers.filterChannelsPayload(payload, { badges: ["openai"], free: true });
assert.equal(filtered.data.channels.edges.length, 1);
assert.equal(filtered.data.channels.edges[0].node.name, "free openai");

const renderedEntries = [
  { node: { name: "openai ok", type: "openai", usesOfficialBaseURL: false, settings: {}, supportedModels: ["gpt-4o"], channelModelPrices: [] }, providerLabel: "u" },
  { node: { name: "zhipu skip", type: "zhipu", usesOfficialBaseURL: false, settings: {}, supportedModels: ["glm"], channelModelPrices: [] }, providerLabel: "u" },
];
const stackedFiltered = renderedEntries
  .filter((entry) => true)
  .filter((entry) => helpers.channelMatches(entry.node, { badges: ["openai"], free: true, modelKeyword: "GPT" }));
assert.equal(stackedFiltered.map((entry) => entry.node.name).join(","), "openai ok");

assert.equal(helpers.popularityScore({
  points: [
    { successRequestCount: 7 },
    { successRequestCount: "3" },
    { successRequestCount: null },
  ],
}), 10);

const sortedByPopularity = helpers.sortEdgesByPopularity([
  { node: { id: "low", name: "low" } },
  { node: { id: "high", name: "high" } },
  { node: { id: "none", name: "none" } },
], new Map([
  ["low", 2],
  ["high", 9],
]));
assert.equal(sortedByPopularity.map((edge) => edge.node.id).join(","), "high,low,none");

const popularFiltered = helpers.filterChannelsPayload({
  data: {
    channels: {
      edges: [
        { node: { id: "low", name: "low", type: "openai", usesOfficialBaseURL: false, settings: {}, channelModelPrices: [] } },
        { node: { id: "high", name: "high", type: "openai", usesOfficialBaseURL: false, settings: {}, channelModelPrices: [] } },
      ],
      totalCount: 2,
    },
  },
}, { badges: [], free: true, sort: "popular_desc" }, new Map([["low", 1], ["high", 8]]));
assert.equal(popularFiltered.data.channels.edges.map((edge) => edge.node.id).join(","), "high,low");

const sortedByName = helpers.sortEdgesByScriptSort([
  { node: { id: "b", name: "Beta", createdAt: "2024-01-01T00:00:00Z", supportedModels: ["b"] } },
  { node: { id: "a", name: "Alpha", createdAt: "2024-01-02T00:00:00Z", supportedModels: ["a"] } },
], { sort: "name_asc" }, new Map());
assert.equal(sortedByName.map((edge) => edge.node.id).join(","), "a,b");

assert.equal(helpers.isChannelsGraphqlBody(JSON.stringify({ query: "query PublicChannels { channels(first: 1) { edges { node { id } } } }" })), true);
assert.equal(helpers.isChannelsGraphqlBody(JSON.stringify({ query: "query MarketplaceModels { marketplaceModels { modelID } }" })), false);
assert.equal(helpers.isChannelsGraphqlBody(JSON.stringify({ query: "query GetChannelProbeData { channelProbeData(input: { channelIDs: [1] }) { channelID points { successRequestCount } } }" })), false);

let defaultSelection = helpers.nextDefaultChannelSelectionState({
  alreadySelected: false,
  channelTabExists: true,
  channelActive: false,
});
assert.equal(defaultSelection.shouldClick, true);
assert.equal(defaultSelection.selected, false);
defaultSelection = helpers.nextDefaultChannelSelectionState({
  alreadySelected: false,
  channelTabExists: true,
  channelActive: true,
});
assert.equal(defaultSelection.shouldClick, false);
assert.equal(defaultSelection.selected, true);
defaultSelection = helpers.nextDefaultChannelSelectionState({
  alreadySelected: true,
  channelTabExists: true,
  channelActive: false,
});
assert.equal(defaultSelection.shouldClick, true);
assert.equal(defaultSelection.selected, false);

const renderedChannelEntries = Array.from({ length: 5 }, (_, index) => ({
  providerLabel: "u",
  node: {
    id: String(index),
    name: `channel ${index}`,
    usesOfficialBaseURL: false,
    supportedModels: ["gpt"],
  },
}));
const renderedSlice = renderedChannelEntries.slice(0, 2);
assert.equal(helpers.shouldKeepFullRenderedSlice(renderedChannelEntries, renderedSlice), true);
assert.equal(helpers.shouldKeepFullRenderedSlice(renderedChannelEntries, renderedChannelEntries), false);
assert.equal(helpers.shouldKeepFullRenderedSlice([1, 2, 3, 4, 5], [1, 2]), false);
assert.equal(helpers.isLikelyPaginationText("Previous 1 2 3 Next"), true);
assert.equal(helpers.isLikelyPaginationText("上一页 1 2 下一页"), true);
assert.equal(helpers.isLikelyPaginationText("Search Channel Tags Sort"), false);
