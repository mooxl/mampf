import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Feeding } from "../server/feedings";
import { Pumping } from "../server/pumpings";
import { MampfRpc } from "./api";
import {
  AddFeedingInput,
  AddPumpingInput,
  FeedingId,
  FeedingView,
  PumpingId,
  PumpingView,
} from "./domain";

describe("shared domain contracts", () => {
  it("shares amount/duration validation between RPC inputs and stored models", () => {
    expect(Feeding.fields.amountMl).toBe(AddFeedingInput.fields.amountMl);
    expect(Pumping.fields.amountMl).toBe(AddFeedingInput.fields.amountMl);
    expect(Pumping.fields.durationMin).toBe(AddPumpingInput.fields.durationMin);
    for (const amountMl of [0, 1001, 1.5]) {
      expect(
        Schema.decodeUnknownResult(AddFeedingInput)({ amountMl, fedAt: "2026-01-01T12:00:00Z" })
          ._tag,
      ).toBe("Failure");
    }
    expect(
      Schema.decodeUnknownResult(AddPumpingInput)({
        side: "both",
        amountMl: 60,
        durationMin: 61,
        pumpedAt: "2026-01-01T12:00:00Z",
      })._tag,
    ).toBe("Failure");
  });

  it("generates IDs that satisfy the same UUID schemas used for delete RPCs", async () => {
    const input = Schema.decodeUnknownSync(AddFeedingInput)({
      amountMl: 90,
      fedAt: "2026-01-01T12:00:00Z",
    });
    const inserted = await Effect.runPromise(Feeding.insert.makeEffect(input));
    const id = Schema.decodeUnknownSync(FeedingId)(inserted.id);
    expect(
      Schema.decodeUnknownResult(MampfRpc.requests.get("DeleteFeeding")!.payloadSchema)({ id })
        ._tag,
    ).toBe("Success");
    expect(
      Schema.decodeUnknownResult(MampfRpc.requests.get("DeleteFeeding")!.payloadSchema)({
        id: "not-a-uuid",
      })._tag,
    ).toBe("Failure");
    expectTypeOf<FeedingView["id"]>().toEqualTypeOf<FeedingId>();
    expectTypeOf<PumpingView["id"]>().toEqualTypeOf<PumpingId>();
    expectTypeOf<FeedingId>().not.toEqualTypeOf<PumpingId>();
  });
});
