import {
  getTemplate,
  PACKAGE_LABELS,
  PAYMENT_TERMS,
  DISCLAIMER,
} from "@/lib/proposal-templates";
import { PricingTable } from "./pricing-table";

interface ProposalDocumentProps {
  clientName: string;
  companyOverview: string;
  packageType: string;
  setupFee: number;
  platformCost: number;
  retainerCost: number;
}

export function ProposalDocument({
  clientName,
  companyOverview,
  packageType,
  setupFee,
  platformCost,
  retainerCost,
}: ProposalDocumentProps) {
  const templates = getTemplate(packageType);
  const packageLabel = PACKAGE_LABELS[packageType] || packageType;

  return (
    <div className="space-y-8 text-gray-800">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {clientName} Proposal
        </h1>
        <p className="mt-1 text-sm text-gray-500">{packageLabel}</p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
        <p className="mt-2 leading-relaxed whitespace-pre-wrap">
          {companyOverview}
        </p>
      </section>

      {/* Package sections */}
      {templates.map((template, idx) => (
        <div key={idx} className="space-y-8">
          {/* Proposal intro */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              {templates.length > 1 ? `${template.label} — ` : ""}Proposal
            </h2>
            <p className="mt-2 leading-relaxed">{template.proposalIntro}</p>
          </section>

          {/* Setup */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900">
              {template.setupTitle}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Infrastructure is anything we need to implement to provide the
              foundations for successful outbound campaigns.
            </p>
            <ul className="mt-3 space-y-1.5">
              {template.setupDetails.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Ongoing */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900">
              {template.ongoingTitle}
            </h3>
            <ul className="mt-3 space-y-1.5">
              {template.ongoingDetails.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Deliverables */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900">
              Monthly Deliverables
            </h3>
            <ul className="mt-3 space-y-1.5">
              {template.deliverables.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Platform fees (LinkedIn only) */}
          {template.platformFees && (
            <section>
              <h3 className="text-lg font-semibold text-gray-900">
                Platform Fees
              </h3>
              <p className="mt-2 text-sm leading-relaxed">
                {template.platformFees}
              </p>
            </section>
          )}
        </div>
      ))}

      {/* Payment & Terms */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900">
          Payment &amp; Terms
        </h2>
        <p className="mt-2 text-sm leading-relaxed">{PAYMENT_TERMS}</p>
      </section>

      {/* Pricing */}
      <section>
        <PricingTable
          setupFee={setupFee}
          platformCost={platformCost}
          retainerCost={retainerCost}
        />
      </section>

      {/* Disclaimer */}
      <section className="rounded-lg bg-gray-50 p-4">
        <p className="text-xs leading-relaxed text-gray-500">{DISCLAIMER}</p>
      </section>
    </div>
  );
}
