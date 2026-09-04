import OperatorHelp from "./operator-help";
import OversizeSplitNotice from "./oversize-split-notice";
import ReceptionPage from "./reception-page";

export default function Page() {
  return (
    <>
      <ReceptionPage />
      <OversizeSplitNotice />
      <OperatorHelp />
    </>
  );
}
