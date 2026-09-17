'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Upload, Lock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { operator } from '@/lib/endpoints';
import { getIdentity } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { FlatImportResult, Society } from '@/lib/types';

const SAMPLE_CSV = `flatNumber,areaFactor,block
A-101,0.0111,A
A-102,0.0111,A
B-201,0.0111,B`;

export default function SocietiesPage() {
  const [isOperator, setIsOperator] = useState<boolean | null>(null);
  useEffect(() => setIsOperator(getIdentity()?.principalKind === 'OPERATOR'), []);

  const qc = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [importFor, setImportFor] = useState<Society | null>(null);

  const societies = useQuery({
    queryKey: ['societies'],
    queryFn: () => operator.listSocieties(),
    enabled: isOperator === true,
  });

  const columns: Column<Society>[] = [
    {
      key: 'name',
      header: 'Society',
      cell: (r) => (
        <div>
          <p className="font-medium text-ink-100">{r.name}</p>
          <p className="text-caption text-ink-40">{r.address}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      key: 'createdAt',
      header: 'Onboarded',
      align: 'right',
      cell: (r) => <span className="tabular text-ink-60">{formatDate(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload className="h-4 w-4" />}
          onClick={(e) => {
            e.stopPropagation();
            setImportFor(r);
          }}
        >
          Import flats
        </Button>
      ),
    },
  ];

  if (isOperator === false) {
    return (
      <>
        <PageHeader title="Societies" subtitle="Society lifecycle management." />
        <Card>
          <EmptyState
            icon={Lock}
            title="Operator access only"
            description="Society creation and the flat register are managed by the platform operator. Committee tools live under Ratifications and Vendors."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Societies"
        subtitle="Create societies and import their flat registers."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New society
          </Button>
        }
      />

      <Card>
        <CardBody className="pt-md">
          <DataTable
            columns={columns}
            rows={societies.data ?? []}
            rowKey={(r) => r.id}
            loading={societies.isLoading}
            empty={
              <EmptyState
                icon={Building2}
                title="No societies yet"
                description="Create your first society to begin onboarding a committee and flat register."
                action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>New society</Button>}
              />
            }
          />
        </CardBody>
      </Card>

      <CreateSocietyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['societies'] })} />
      <ImportFlatsModal society={importFor} onClose={() => setImportFor(null)} />
    </>
  );

  function StatusBadge({ status }: { status: string }) {
    const tone = status === 'ACTIVE' ? 'success' : status === 'ONBOARDING' ? 'warning' : 'neutral';
    return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
  }
}

function CreateSocietyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState<string>();

  const mutation = useMutation({
    mutationFn: () => operator.createSociety({ name: name.trim(), address: address.trim() }),
    onSuccess: (s) => {
      toast.success(`${s.name} created.`);
      onCreated();
      setName('');
      setAddress('');
      setErr(undefined);
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not create the society.'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New society"
      description="The operator creates the society; the committee is assigned next."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={!name.trim() || !address.trim()}>
            Create society
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        <Field label="Society name" required placeholder="Sunshine Residence" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Address" required placeholder="Sector 21, Gurugram" value={address} onChange={(e) => setAddress(e.target.value)} error={err} />
      </div>
    </Modal>
  );
}

function ImportFlatsModal({ society, onClose }: { society: Society | null; onClose: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [result, setResult] = useState<FlatImportResult | null>(null);
  const [err, setErr] = useState<string>();

  const mutation = useMutation({
    mutationFn: () => operator.importFlats(society!.id, csv),
    onSuccess: (r) => {
      setResult(r);
      setErr(undefined);
      toast.success(`Imported ${r.imported} flats.`);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Import failed.'),
  });

  const areaOk = result?.areaFactorSum === undefined ? null : Math.abs(result.areaFactorSum - 1) < 1e-6;

  return (
    <Modal
      open={!!society}
      onClose={() => {
        setResult(null);
        setErr(undefined);
        onClose();
      }}
      title={society ? `Import flats — ${society.name}` : 'Import flats'}
      description="Paste the flat register as CSV. Area factors must sum to 1."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={!csv.trim()}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-md">
        <Textarea
          label="CSV"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          error={err}
          hint="Columns: flatNumber, areaFactor, block"
        />
        {result && (
          <div className="rounded-lg border border-border-subtle bg-bg-secondary p-md">
            <div className="flex flex-wrap gap-md">
              <Stat label="Imported" value={result.imported} />
              <Stat label="Skipped" value={result.skipped} />
              {areaOk !== null && (
                <div>
                  <p className="text-overline uppercase text-ink-40">Area factor sum</p>
                  <p className="tabular mt-xxs text-body font-semibold">
                    <span className={areaOk ? 'text-feedback-success' : 'text-feedback-danger'}>
                      {result.areaFactorSum?.toFixed(4)}
                    </span>{' '}
                    <Badge tone={areaOk ? 'success' : 'danger'}>{areaOk ? 'Balanced' : 'Off by tolerance'}</Badge>
                  </p>
                </div>
              )}
            </div>
            {result.errors?.length > 0 && (
              <ul className="mt-sm list-inside list-disc text-caption text-feedback-danger">
                {result.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-overline uppercase text-ink-40">{label}</p>
      <p className="tabular mt-xxs text-body font-semibold text-ink-100">{value}</p>
    </div>
  );
}
