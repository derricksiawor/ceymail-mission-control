import { InstallWizard } from "@/components/install/install-wizard";

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-mc-text">CeyMail Installation</h1>
        <p className="text-sm text-mc-text-muted">
          Set up your mail server step by step
        </p>
      </div>
      <InstallWizard />
    </div>
  );
}
