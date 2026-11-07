// An echoed render tag usually arrives WITHOUT its close: the model writes the
// opening plus the ref it saw in history, then a line break and its actual
// answer — `<acp tokens="31" type="text" time="…">m00039\n子作成完了`. The
// opening's own content is that leading ref run; whatever follows it is the
// answer. Streaming used to drop the whole tail at EOF (short answers vanished)
// and every release path kept the ref (`m00039\n…` leaked), while whole-text
// kept the ref too. Both modes now drop the opening with its ref run and keep
// the answer, identically for every chunking.
import test from "node:test";
import assert from "node:assert/strict";
import { createTagEchoFilter, stripAcpTags } from "../src/loop/tag-echo-filter.ts";

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function runStream(input: string, sizeOf: () => number): string {
    const f = createTagEchoFilter();
    let out = "";
    for (let pos = 0; pos < input.length; ) {
        const n = sizeOf();
        out += f.push(input.slice(pos, pos + n));
        pos += n;
    }
    return out + f.flush();
}

function chunkings(input: string): Array<[string, string]> {
    const runs: Array<[string, string]> = [["whole", runStream(input, () => input.length)]];
    for (const n of [1, 2, 3, 5, 8, 13]) runs.push([`size=${n}`, runStream(input, () => n)]);
    for (let seed = 1; seed <= 20; seed++) {
        const rnd = mulberry32(seed);
        runs.push([`seed=${seed}`, runStream(input, () => 1 + Math.floor(rnd() * 40))]);
    }
    return runs;
}

const open = (tokens: number) => `<acp tokens="${tokens}" type="text" time="2026-11-06 15:30:10">`;
const LONG = "子作成完了: #2109 (調査) / #2110 (解決)。評価エージェントが定義されているか確認してから計画評価依頼をする。".repeat(2);

const KEEPS_ANSWER: Array<[string, string, string]> = [
    ["short answer", `${open(31)}m00039\n子作成完了`, "\n子作成完了"],
    ["answer past the swallow budget", `${open(31)}m00039\n${LONG}`, `\n${LONG}`],
    ["stacked openings", `${open(12)}m00104\n${open(13)}m00105\n計画修正完了。`, "\n\n計画修正完了。"],
];

for (const [name, input, expected] of KEEPS_ANSWER) {
    test(`unclosed opening + ref + answer keeps the answer in both modes: ${name}`, () => {
        assert.equal(stripAcpTags(input), expected, "whole-text");
        for (const [how, out] of chunkings(input)) assert.equal(out, expected, `streaming ${how}`);
    });
}

test("an unclosed opening whose tail is only its ref still drops whole", () => {
    const input = `${open(31)}m00039`;
    assert.equal(stripAcpTags(input), "", "whole-text");
    for (const [how, out] of chunkings(input)) assert.equal(out, "", `streaming ${how}`);
});

test("an unclosed opening cut inside its ref at EOF still drops whole (#644)", () => {
    for (const [how, out] of chunkings(`${open(31)}m000`)) assert.equal(out, "", `streaming ${how}`);
});
