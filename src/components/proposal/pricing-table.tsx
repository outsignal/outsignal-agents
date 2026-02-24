import { formatPence } from "@/lib/proposal-templates";

interface PricingTableProps {
  setupFee: number;
  platformCost: number;
  retainerCost: number;
}

export function PricingTable({
  setupFee,
  platformCost,
  retainerCost,
}: PricingTableProps) {
  const monthlyTotal = platformCost + retainerCost;

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-3 text-left font-medium text-gray-600">
              Item
            </th>
            <th className="px-6 py-3 text-right font-medium text-gray-600">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <td className="px-6 py-3">Contract Length</td>
            <td className="px-6 py-3 text-right">Ongoing — Monthly</td>
          </tr>
          {setupFee > 0 && (
            <tr className="border-t">
              <td className="px-6 py-3">Setup Fee</td>
              <td className="px-6 py-3 text-right">
                {formatPence(setupFee)} (one-off)
              </td>
            </tr>
          )}
          <tr className="border-t">
            <td className="px-6 py-3">Platform Costs</td>
            <td className="px-6 py-3 text-right">
              {formatPence(platformCost)}/month
            </td>
          </tr>
          <tr className="border-t">
            <td className="px-6 py-3">Retainer</td>
            <td className="px-6 py-3 text-right">
              {formatPence(retainerCost)}/month
            </td>
          </tr>
          <tr className="border-t bg-gray-50 font-bold">
            <td className="px-6 py-3">Total</td>
            <td className="px-6 py-3 text-right">
              {formatPence(monthlyTotal)}/month
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
