"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  Key,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";

interface SummaryProps {
  hostname: string;
  mailDomain: string;
  adminEmail: string;
  serverIp: string;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: string;
}

export function Summary({ hostname, mailDomain, adminEmail, serverIp }: SummaryProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [dkimPublicKey, setDkimPublicKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const domain = mailDomain || "your-domain.com";
  const host = hostname || "mail.your-domain.com";

  // Fetch real DKIM key from API
  useEffect(() => {
    let cancelled = false;

    async function fetchDkim() {
      try {
        const res = await fetch("/api/dkim");
        if (!res.ok) throw new Error("Failed to fetch DKIM");
        const keys = await res.json();
        if (cancelled) return;

        // Find the key for the configured domain
        const domainKey = keys.find((k: { domain: string }) => k.domain === domain);
        if (domainKey && domainKey.dnsRecord) {
          setDkimPublicKey(domainKey.dnsRecord);
        } else {
          setDkimPublicKey("(DKIM key not yet generated for this domain)");
        }
      } catch {
        if (cancelled) return;
        setDkimPublicKey("(Unable to retrieve DKIM key)");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDkim();
    return () => { cancelled = true; };
  }, [domain]);

  const dnsRecords: DnsRecord[] = useMemo(() => [
    {
      type: "A",
      name: host,
      value: serverIp || "YOUR_SERVER_IP",
    },
    {
      type: "MX",
      name: domain,
      value: host,
      priority: "10",
    },
    {
      type: "TXT",
      name: domain,
      value: `v=spf1 mx a:${host} ~all`,
    },
    {
      type: "TXT",
      name: `mail._domainkey.${domain}`,
      value: dkimPublicKey || "(pending)",
    },
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:${adminEmail || `postmaster@${domain}`}`,
    },
    {
      type: "PTR",
      name: serverIp || "YOUR_SERVER_IP",
      value: host,
    },
  ], [host, domain, dkimPublicKey, adminEmail, serverIp]);

  const copyToClipboard = useCallback(async (text: string, field: string) => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 2000);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          setCopiedField(field);
          copyTimerRef.current = setTimeout(() => setCopiedField(null), 2000);
        }
      } catch {
        // Both methods failed — do not show success
      }
    }
  }, []);

  const copyAllDns = useCallback(() => {
    const text = dnsRecords
      .map(
        (r) =>
          `${r.type}\t${r.name}\t${r.priority ? r.priority + "\t" : ""}${r.value}`
      )
      .join("\n");
    copyToClipboard(text, "all-dns");
  }, [dnsRecords, copyToClipboard]);

  return (
    <div className="min-w-0 space-y-6">
      {/* Success banner */}
      <div className="flex items-start gap-4 rounded-lg border border-mc-success/30 bg-mc-success/5 p-5">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-mc-success" />
        <div>
          <h3 className="text-lg font-semibold text-mc-success">
            Installation Complete
          </h3>
          <p className="mt-1 text-sm text-mc-text-muted">
            CeyMail has been successfully installed and configured. Complete the
            DNS setup below to start receiving mail.
          </p>
        </div>
      </div>

      {/* Access info */}
      <div className="rounded-lg border border-mc-border bg-mc-surface p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
          <ShieldCheck className="h-4 w-4 text-mc-accent" />
          Dashboard Access
        </div>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-mc-bg px-3 py-2 font-mono text-sm text-mc-accent">
            https://{host}
          </code>
          <button
            onClick={() => copyToClipboard(`https://${host}`, "url")}
            className="flex items-center justify-center rounded-md bg-mc-accent/10 min-h-[44px] min-w-[44px] text-mc-accent transition-colors hover:bg-mc-accent/20"
            title="Copy URL"
          >
            {copiedField === "url" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* DNS Records */}
      <div className="overflow-hidden rounded-lg border border-mc-border bg-mc-surface">
        <div className="flex items-center justify-between border-b border-mc-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-mc-accent" />
            <h4 className="text-sm font-semibold text-mc-text">
              Required DNS Records
            </h4>
          </div>
          <button
            onClick={copyAllDns}
            className="flex items-center gap-1.5 rounded-md bg-mc-accent/10 px-3 min-h-[44px] text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20"
          >
            {copiedField === "all-dns" ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy All
              </>
            )}
          </button>
        </div>

        <div className="divide-y divide-mc-border">
          {dnsRecords.map((record, index) => {
            const fieldKey = `dns-${index}`;
            const recordText = `${record.type}\t${record.name}\t${record.priority ? record.priority + "\t" : ""}${record.value}`;

            return (
              <div
                key={index}
                className="group flex items-start gap-3 px-4 py-3"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                    record.type === "A" && "bg-mc-accent/10 text-mc-accent",
                    record.type === "MX" && "bg-mc-success/10 text-mc-success",
                    record.type === "TXT" && "bg-mc-warning/10 text-mc-warning",
                    record.type === "PTR" && "bg-mc-info/10 text-mc-info"
                  )}
                >
                  {record.type}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-mc-text">
                    {record.name}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-xs text-mc-text-muted">
                    {record.priority && (
                      <span className="text-mc-accent">
                        Priority: {record.priority}{" "}
                      </span>
                    )}
                    {record.value}
                  </p>
                </div>

                <button
                  onClick={() => copyToClipboard(recordText, fieldKey)}
                  className="shrink-0 flex items-center justify-center rounded-md min-h-[44px] min-w-[44px] text-mc-text-muted opacity-60 transition-all hover:bg-mc-surface-hover hover:text-mc-text hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  title="Copy record"
                >
                  {copiedField === fieldKey ? (
                    <Check className="h-3.5 w-3.5 text-mc-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* DKIM Key */}
      <div className="overflow-hidden rounded-lg border border-mc-border bg-mc-surface">
        <div className="flex items-center justify-between border-b border-mc-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-mc-warning" />
            <h4 className="text-sm font-semibold text-mc-text">
              DKIM Public Key
            </h4>
          </div>
          <button
            onClick={() => copyToClipboard(dkimPublicKey, "dkim")}
            className="flex items-center gap-1.5 rounded-md bg-mc-accent/10 px-3 min-h-[44px] text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20"
          >
            {copiedField === "dkim" ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy Key
              </>
            )}
          </button>
        </div>
        <div className="p-4">
          <p className="mb-2 text-xs text-mc-text-muted">
            Add this as a TXT record for{" "}
            <code className="text-mc-accent">mail._domainkey.{domain}</code>
          </p>
          <pre className="whitespace-pre-wrap break-all rounded-md bg-mc-bg p-3 font-mono text-xs leading-relaxed text-mc-text-muted">
            {loading ? "Loading DKIM key..." : dkimPublicKey}
          </pre>
        </div>
      </div>

      {/* Next steps */}
      <div className="rounded-lg border border-mc-accent/20 bg-mc-accent/5 p-4">
        <h4 className="mb-2 text-sm font-semibold text-mc-accent">
          Next Steps
        </h4>
        <ul className="space-y-1.5 text-sm text-mc-text-muted">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-mc-accent" />
            Configure DNS records with your domain registrar
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-mc-accent" />
            Wait for DNS propagation (can take up to 48 hours)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-mc-accent" />
            Verify DKIM and SPF records using the DKIM page in the dashboard
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-mc-accent" />
            Send a test email and check deliverability
          </li>
        </ul>
      </div>
    </div>
  );
}
