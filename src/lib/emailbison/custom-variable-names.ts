/**
 * Custom variable names for EmailBison.
 *
 * IMPORTANT: EB lowercases all custom variable names on creation. Our lead
 * payload must send the same lowercase names, otherwise EB rejects with
 * "You do not have a custom variable named X". Always use lowercase here.
 */

export const EMAILBISON_CUSTOM_VARIABLE_NAMES = [
  "location",
  "lastemailmonth",
  "ooo_greeting",
] as const;

export const EMAILBISON_CUSTOM_VARIABLE_NAME_SET: ReadonlySet<string> =
  new Set(EMAILBISON_CUSTOM_VARIABLE_NAMES);

export const EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES = [
  "location",
  "lastemailmonth",
] as const;
