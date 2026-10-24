import { it, expect } from "vitest";
import { decodeReplay } from "./index";
import { stateAt } from "../../replay-player/src/index";
import basic from "../fixtures/basic-three-lane.json";
it("replay 0.2 preserves confirmed healing and level-up max HP", () => {
  const e = basic.initialView[0];
  const r = { ...structuredClone(basic), schemaVersion:"0.2", timeline:[
    {type:"damage",tick:1,order:0,entityId:e.id,hp:e.hp-20},
    {type:"vitals",tick:2,order:0,entityId:e.id,hp:e.hp+10,maxHp:e.maxHp+10},
    {type:"match-end",tick:3,order:0,result:{winner:"draw",reason:"timeout",tick:3}},
  ], result:{winner:"draw",reason:"timeout",tick:3} };
  const replay = decodeReplay(r);
  expect(stateAt(replay,1).entities[e.id].hp).toBe(e.hp-20);
  expect(stateAt(replay,2).entities[e.id].hp).toBe(e.hp+10);
  expect(stateAt(replay,2).entities[e.id].maxHp).toBe(e.maxHp+10);
  expect(()=>decodeReplay({...r,schemaVersion:"0.1"})).toThrow("requires replay 0.2");
  expect(()=>decodeReplay({...r,schemaVersion:"9.0"})).toThrow();
});
