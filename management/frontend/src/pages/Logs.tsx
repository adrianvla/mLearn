import { useEffect, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Select, SelectItem } from '@heroui/react';
import { RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState } from '../components/shared';
import { redactLine } from '../redact';
import type { LogsDto } from '../api/types';

const TAIL_OPTIONS: number[] = [50, 100, 300, 500];

export default function Logs() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [tail, setTail] = useState<number>(300);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const servicesApi = useApi(() => api.getServices(), []);
  const logsApi = useApi<LogsDto | null>(
    () => (selectedService === null ? Promise.resolve(null) : api.getLogs(selectedService, tail)),
    [selectedService, tail],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logsApi.data]);

  const handleCopy = async (): Promise<void> => {
    const data = logsApi.data;
    if (data === null) return;
    const text = data.lines
      .map((line) => {
        const prefix = line.timestamp === null ? '' : `${line.timestamp} `;
        return `${prefix}${line.message}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const services = servicesApi.data ?? [];
  const logs = logsApi.data;
  const hasOutput = logs !== null && logs.lines.length > 0;

  return (
    <PageContainer>
      <PageHeader title="Logs" subtitle="Tail and inspect container log output with automatic secret redaction" />

      {servicesApi.error !== null && (
        <div className="mb-4">
          <ErrorState message={`Failed to load services: ${servicesApi.error}`} />
        </div>
      )}

      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label="Service"
              className="sm:max-w-xs"
              placeholder="Select a service"
              isDisabled={services.length === 0}
              isLoading={servicesApi.loading && services.length === 0}
              selectedKeys={selectedService === null ? [] : [selectedService]}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const next = Array.from(keys)[0];
                if (next === undefined) {
                  setSelectedService(null);
                } else {
                  setSelectedService(String(next));
                }
              }}
            >
              {services.map((service) => (
                <SelectItem key={service.id}>
                  {service.service_name ?? service.container_name}
                </SelectItem>
              ))}
            </Select>

            <Select
              label="Tail"
              className="sm:max-w-40"
              selectedKeys={[String(tail)]}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const next = Array.from(keys)[0];
                if (next !== undefined) {
                  setTail(Number(next));
                }
              }}
            >
              {TAIL_OPTIONS.map((value) => (
                <SelectItem key={String(value)}>{value} lines</SelectItem>
              ))}
            </Select>

            <Button
              color="primary"
              variant="flat"
              isDisabled={selectedService === null}
              isLoading={logsApi.loading && selectedService !== null}
              onPress={logsApi.refetch}
              startContent={<RefreshCw className="h-4 w-4" />}
            >
              Refresh
            </Button>
          </div>
        </CardBody>
      </Card>

      {logsApi.error !== null ? (
        <ErrorState message={logsApi.error} />
      ) : (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">Output</h2>
              {logs !== null && logs.truncated && (
                <Chip
                  size="sm"
                  color="warning"
                  variant="flat"
                  startContent={<AlertTriangle className="h-3 w-3" />}
                >
                  Truncated
                </Chip>
              )}
            </div>
            <Button
              size="sm"
              variant="flat"
              isDisabled={!hasOutput}
              onPress={handleCopy}
              startContent={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </CardHeader>
          <CardBody>
            {selectedService === null ? (
              <div className="flex h-64 items-center justify-center text-default-400">
                Select a service to view logs
              </div>
            ) : logsApi.loading && logs === null ? (
              <LoadingState label="Loading logs…" />
            ) : hasOutput ? (
              <div
                ref={scrollRef}
                className="h-[30rem] overflow-auto rounded-lg bg-content2 p-3 font-mono text-xs leading-relaxed"
              >
                {logs.lines.map((line, index) => (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    {line.timestamp !== null && (
                      <span className="text-default-400">{line.timestamp} </span>
                    )}
                    <span className={line.stream === 'stderr' ? 'text-danger' : 'text-foreground'}>
                      {redactLine(line.message)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-default-400">
                No log output for this service
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
