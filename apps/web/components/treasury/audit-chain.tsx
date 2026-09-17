'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Link2, Copy, Check, Fingerprint } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { treasury } from '@/lib/endpoints';
import { formatCount } from '@/lib/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { AuditVerifyResult } from '@/lib/types';

export function AuditChainVerifier() {
  const toast = useToast();
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [copied, setCopied] = useState(false);

  const verify = useMutation({
    mutationFn: treasury.verifyChain,
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success(`All ${r.verifiedThrough} records verified.`);
      else toast.error(`Record ${r.firstDivergence?.sequence ?? '?'} was altered.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Verification failed.'),
  });

  const ok = result?.ok;

  async function copyHash() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.tailHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Banner */}
      <div
        className="relative px-lg py-xl"
        style={{ background: 'radial-gradient(120% 140% at 12% 0%, #0F766E 0%, #115E59 45%, #14181A 100%)' }}
      >
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: 'linear-gradient(#5EEAD4 1px, transparent 1px), linear-gradient(90deg, #5EEAD4 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative flex items-start justify-between gap-md">
          <div className="flex items-center gap-sm">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
              <Link2 className="h-6 w-6 text-accent-300" />
            </span>
            <div>
              <h3 className="text-heading font-semibold text-white">Tamper-proof records</h3>
              <p className="text-caption text-white/70">Every action is cryptographically linked, so nothing can be edited unnoticed.</p>
            </div>
          </div>
          <Button variant="secondary" icon={<Fingerprint className="h-4 w-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>
            {result ? 'Re-check' : 'Verify records'}
          </Button>
        </div>
      </div>

      <CardBody>
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.p
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-body text-ink-60"
            >
              Check every record on demand. You&apos;ll see either that all records check out, or the first record
              that was altered.
            </motion.p>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-md"
            >
              <div className="flex items-center gap-md">
                <motion.span
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                  className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', ok ? 'bg-feedback-successTint' : 'bg-feedback-dangerTint')}
                >
                  {ok ? <ShieldCheck className="h-7 w-7 text-feedback-success" /> : <ShieldAlert className="h-7 w-7 text-feedback-danger" />}
                </motion.span>
                <div>
                  <div className="flex items-center gap-sm">
                    <p className="text-heading font-semibold text-ink-100">{ok ? 'Records verified' : 'Tampering found'}</p>
                    <Badge tone={ok ? 'success' : 'danger'}>{ok ? 'Verified' : 'Altered'}</Badge>
                  </div>
                  <p className="text-caption text-ink-60">
                    {ok
                      ? `All ${formatCount(result.verifiedThrough)} records check out.`
                      : `Record ${result.firstDivergence?.sequence ?? '?'} was altered (${formatCount(result.verifiedThrough)} verified before it).`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Metric label="Records checked" value={formatCount(result.verifiedThrough)} />
                <Metric label="First mismatch" value={result.firstDivergence ? `Record ${result.firstDivergence.sequence}` : 'None'} tone={result.firstDivergence ? 'danger' : 'success'} />
              </div>

              <div className="rounded-lg border border-border-subtle bg-bg-secondary p-md">
                <div className="flex items-center justify-between">
                  <span className="text-overline uppercase text-ink-40">Fingerprint</span>
                  <button onClick={copyHash} className="flex items-center gap-xxs text-caption text-ink-60 transition-colors hover:text-ink-100">
                    {copied ? <Check className="h-3.5 w-3.5 text-feedback-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="tabular mt-xxs break-all text-caption text-ink-80">{result.tailHash}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-lg border border-border-subtle p-md">
      <p className="text-overline uppercase text-ink-40">{label}</p>
      <p className={cn('tabular mt-xxs text-body font-semibold', tone === 'danger' ? 'text-feedback-danger' : tone === 'success' ? 'text-feedback-success' : 'text-ink-100')}>
        {value}
      </p>
    </div>
  );
}
