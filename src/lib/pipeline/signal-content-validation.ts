import {
  runFullSequenceValidation,
  type CopyStrategy,
} from "@/lib/copy-quality";

export interface SignalSequenceLike {
  position?: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body?: string;
}

export interface SignalContentValidationResult {
  hardViolations: Array<{ step: number; field: string; violation: string }>;
  softWarnings: Array<{ step: number; field: string; violation: string }>;
}

/**
 * Run the same sequence-quality validation used by portal approval on signal
 * campaigns before they are activated.
 */
export function validateSignalCampaignContent(params: {
  channels: string[];
  copyStrategy?: string | null;
  emailSequence?: SignalSequenceLike[] | null;
  linkedinSequence?: SignalSequenceLike[] | null;
}): SignalContentValidationResult {
  const strategy = (params.copyStrategy as CopyStrategy) ?? "pvp";

  let hardViolations: SignalContentValidationResult["hardViolations"] = [];
  let softWarnings: SignalContentValidationResult["softWarnings"] = [];

  if (params.emailSequence && params.emailSequence.length > 0) {
    const emailResult = runFullSequenceValidation(params.emailSequence, {
      strategy,
      channel: "email",
    });
    hardViolations = hardViolations.concat(emailResult.hardViolations);
    softWarnings = softWarnings.concat(emailResult.softWarnings);
  }

  if (
    params.linkedinSequence &&
    params.linkedinSequence.length > 0 &&
    params.channels.includes("linkedin")
  ) {
    const linkedinResult = runFullSequenceValidation(params.linkedinSequence, {
      strategy,
      channel: "linkedin",
    });
    hardViolations = hardViolations.concat(
      linkedinResult.hardViolations.map((v) => ({
        ...v,
        field: `linkedin:${v.field}`,
      })),
    );
    softWarnings = softWarnings.concat(
      linkedinResult.softWarnings.map((v) => ({
        ...v,
        field: `linkedin:${v.field}`,
      })),
    );
  }

  return { hardViolations, softWarnings };
}
