import { Option, Schema } from "effect";

export const IcsExportNotice = Schema.Struct({
  message: Schema.String,
  personId: Schema.String,
  revision: Schema.Int,
});

export const IcsExportUi = Schema.Struct({
  notice: Schema.Option(IcsExportNotice),
  revision: Schema.Int,
});

export const initialIcsExport = (): typeof IcsExportUi.Type => ({
  notice: Option.none(),
  revision: 0,
});
