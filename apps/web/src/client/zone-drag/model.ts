import { Schema } from "effect";

import { ZoneId } from "../../layout/time-zones.js";

export const ZoneDragPreview = Schema.Struct({
  id: ZoneId,
  index: Schema.Int,
});

export const ZoneDragPoint = Schema.Struct({
  pointerId: Schema.Int,
  x: Schema.Finite,
  y: Schema.Finite,
});

export const ZoneDragStart = Schema.Struct({
  ...ZoneDragPoint.fields,
  id: ZoneId,
});

export const ZoneDragDown = Schema.Struct({
  ...ZoneDragStart.fields,
  hostKey: Schema.String,
  ids: Schema.Array(ZoneId),
});

export const ZoneDragResult = Schema.Struct({
  ...ZoneDragPreview.fields,
  sequence: Schema.Int,
});
