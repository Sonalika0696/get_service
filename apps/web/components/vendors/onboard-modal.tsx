'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/input';
import { TagInput } from '@/components/ui/tag-input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { committee } from '@/lib/endpoints';
import { VENDOR_CATEGORY_PRESETS } from '@/lib/vendor';
import { ApiError } from '@/lib/api';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function OnboardVendorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [gstin, setGstin] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setName('');
    setCategories([]);
    setContactEmail('');
    setContactPhone('');
    setRadiusKm('');
    setGstin('');
    setErrors({});
  }

  const mutation = useMutation({
    mutationFn: () =>
      committee.onboardVendor({
        name: name.trim(),
        categories,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        radiusKm: radiusKm.trim() ? Number(radiusKm) : undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
      }),
    onSuccess: (v) => {
      toast.success(`${v.name} onboarded. Verify the GSTIN to attest.`);
      qc.invalidateQueries({ queryKey: ['vendors'] });
      reset();
      onClose();
    },
    onError: (e) =>
      setErrors({ form: e instanceof ApiError ? e.message : 'Could not onboard the vendor.' }),
  });

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'A vendor name is required.';
    if (categories.length === 0) next.categories = 'Pick at least one category.';
    if (gstin.trim() && !GSTIN_RE.test(gstin.trim().toUpperCase()))
      next.gstin = 'That does not look like a valid 15-character GSTIN.';
    if (contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim()))
      next.contactEmail = 'Enter a valid email or leave it blank.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Onboard a vendor"
      description="Add a vendor to the directory. The GSTIN is verified separately at approval."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            icon={<BadgeCheck className="h-4 w-4" />}
            loading={mutation.isPending}
            onClick={() => validate() && mutation.mutate()}
          >
            Onboard vendor
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        {errors.form && (
          <p role="alert" className="rounded-md bg-feedback-dangerTint px-sm py-xs text-caption text-feedback-danger">
            {errors.form}
          </p>
        )}
        <Field
          label="Vendor name"
          required
          placeholder="CoolBreeze AC Services"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TagInput
          label="Categories"
          required
          value={categories}
          onChange={setCategories}
          presets={VENDOR_CATEGORY_PRESETS}
        />
        {errors.categories && <p className="-mt-xs text-caption text-feedback-danger">{errors.categories}</p>}

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            label="Contact email"
            type="email"
            placeholder="ops@vendor.in"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            error={errors.contactEmail}
          />
          <Field
            label="Contact phone"
            inputMode="tel"
            placeholder="+91 98xxxxxx"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            label="Service radius (km)"
            inputMode="decimal"
            placeholder="8"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Field
            label="GSTIN"
            placeholder="22AAAAA0000A1Z5"
            hint="Optional. Checked against the GSTIN registry at approval."
            className="tabular uppercase"
            maxLength={15}
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            error={errors.gstin}
          />
        </div>
      </div>
    </Modal>
  );
}
