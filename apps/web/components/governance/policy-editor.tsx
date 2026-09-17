'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw } from 'lucide-react';
import { Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { governance } from '@/lib/endpoints';
import { DEFAULT_APPROVAL_CONFIG, validateApprovalConfig } from '@/lib/approval';
import { ApiError } from '@/lib/api';
import type { ApprovalConfig } from '@/lib/types';

export function PolicyEditor({ config, canEdit }: { config: ApprovalConfig; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [lower, setLower] = useState(String(config.lowerThreshold));
  const [upper, setUpper] = useState(String(config.upperThreshold));
  const [fractionPct, setFractionPct] = useState(String(Math.round(config.majorityFraction * 100)));
  const [error, setError] = useState<string>();

  useEffect(() => {
    setLower(String(config.lowerThreshold));
    setUpper(String(config.upperThreshold));
    setFractionPct(String(Math.round(config.majorityFraction * 100)));
  }, [config]);

  const draft: ApprovalConfig = {
    lowerThreshold: Number(lower) || 0,
    upperThreshold: Number(upper) || 0,
    majorityFraction: (Number(fractionPct) || 0) / 100,
  };

  const dirty =
    draft.lowerThreshold !== config.lowerThreshold ||
    draft.upperThreshold !== config.upperThreshold ||
    draft.majorityFraction !== config.majorityFraction;

  const save = useMutation({
    mutationFn: () => governance.setApprovalConfig(draft),
    onSuccess: () => {
      toast.success('Approval policy updated.');
      qc.invalidateQueries({ queryKey: ['approvalConfig'] });
      setError(undefined);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the policy.'),
  });

  function onSave() {
    const v = validateApprovalConfig(draft);
    if (v) {
      setError(v);
      return;
    }
    save.mutate();
  }

  function resetDefaults() {
    setLower(String(DEFAULT_APPROVAL_CONFIG.lowerThreshold));
    setUpper(String(DEFAULT_APPROVAL_CONFIG.upperThreshold));
    setFractionPct(String(Math.round(DEFAULT_APPROVAL_CONFIG.majorityFraction * 100)));
  }

  return (
    <div className="flex flex-col gap-md">
      {!canEdit && (
        <p className="rounded-md bg-feedback-infoTint px-sm py-xs text-caption text-feedback-info">
          You can view these rules. Editing needs admin access.
        </p>
      )}
      <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
        <Field
          label="Small up to (₹)"
          inputMode="numeric"
          hint="At or below: 1 admin approves."
          value={lower}
          onChange={(e) => setLower(e.target.value.replace(/[^\d]/g, ''))}
          disabled={!canEdit}
        />
        <Field
          label="Medium up to (₹)"
          inputMode="numeric"
          hint="Above small, up to here: 2 admins."
          value={upper}
          onChange={(e) => setUpper(e.target.value.replace(/[^\d]/g, ''))}
          disabled={!canEdit}
        />
        <Field
          label="Large: admins needed (%)"
          inputMode="numeric"
          hint="Above medium: this share of admins."
          value={fractionPct}
          onChange={(e) => setFractionPct(e.target.value.replace(/[^\d]/g, ''))}
          disabled={!canEdit}
          error={error}
        />
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-sm">
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={resetDefaults} disabled={save.isPending}>
            Reset to defaults
          </Button>
          <Button icon={<Save className="h-4 w-4" />} onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Save policy
          </Button>
        </div>
      )}
    </div>
  );
}
