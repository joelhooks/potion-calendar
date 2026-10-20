import { Option, Schema } from "effect";

export const SelectionSet = Schema.Array(Schema.NonEmptyString).check(
  Schema.isUnique()
);

export type SelectionSetValue = typeof SelectionSet.Type;

export const SelectionPoint = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
});

export const SelectionBox = Schema.Struct({
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  left: Schema.Finite,
  top: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const SelectionFragment = Schema.Struct({
  box: SelectionBox,
  key: Schema.NonEmptyString,
});

export const SelectionAction = Schema.TaggedUnion({
  Add: { key: Schema.NonEmptyString },
  Clear: {},
  Click: {
    key: Schema.NonEmptyString,
    mod: Schema.Boolean,
    shift: Schema.Boolean,
  },
  SelectAll: { visible: Schema.Array(Schema.NonEmptyString) },
  Toggle: { key: Schema.NonEmptyString },
});

const unique = (keys: readonly string[]): SelectionSetValue => [
  ...new Set(keys),
];

const toggle = (
  selection: SelectionSetValue,
  key: string
): SelectionSetValue =>
  selection.includes(key)
    ? selection.filter((selected) => selected !== key)
    : [...selection, key];

export const changeSelection = (
  selection: SelectionSetValue,
  action: typeof SelectionAction.Type
): SelectionSetValue =>
  SelectionAction.match(action, {
    Add: ({ key }) =>
      selection.includes(key) ? selection : [...selection, key],
    Clear: () => [],
    Click: ({ key, mod, shift }) =>
      mod || shift ? toggle(selection, key) : [key],
    SelectAll: ({ visible }) => unique(visible),
    Toggle: ({ key }) => toggle(selection, key),
  });

export const primarySelection = (selection: SelectionSetValue) =>
  Option.fromUndefinedOr(selection.at(-1));

export const selectionContext = (selection: SelectionSetValue) => ({
  bulkOnly: selection.length > 1,
  label: selection.length > 1 ? `${selection.length} events selected` : "",
  primary: primarySelection(selection),
});

const overlaps = (boxes: readonly (typeof SelectionBox.Type)[]): boolean =>
  Math.max(...boxes.map((box) => box.left)) <
    Math.min(...boxes.map((box) => box.left + box.width)) &&
  Math.max(...boxes.map((box) => box.top)) <
    Math.min(...boxes.map((box) => box.top + box.height));

export const rectangleSelection = (
  fragments: readonly (typeof SelectionFragment.Type)[],
  from: typeof SelectionPoint.Type,
  to: typeof SelectionPoint.Type,
  viewport: typeof SelectionBox.Type
): SelectionSetValue => {
  const rectangle = {
    height: Math.abs(to.y - from.y),
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
  };

  return unique(
    fragments.flatMap(({ box, key }) =>
      overlaps([box, viewport, rectangle]) ? [key] : []
    )
  );
};
