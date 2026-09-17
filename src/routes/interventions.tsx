import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Play, CheckCircle2, Clock, Filter, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import { interventionService } from "@/lib/services";
import { classRepository } from "@/lib/db/repositories/class";
import type { DbClass } from "@/lib/db/schema";
import type { RiskLevel, InterventionStatus } from "@/lib/types";

export const Route = createFileRoute("/interventions")({
  head: () => ({
    meta: [
      { title: "Interventions — AttendAI" },
      { name: "description", content: "Automated student interventions based on attendance risk." },
    ],
  }),
  component: InterventionsDashboard,
});

function RiskBadge({ level }: { level: RiskLevel }) {
  if (level === "critical")
    return (
      <Badge
        variant="outline"
        className="border-destructive bg-destructive/15 text-destructive font-semibold"
      >
        Critical Risk
      </Badge>
    );
  if (level === "high")
    return (
      <Badge
        variant="outline"
        className="border-destructive/30 bg-destructive/10 text-destructive font-medium"
      >
        High Risk
      </Badge>
    );
  if (level === "medium")
    return (
      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning font-medium">
        Medium Risk
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-success font-medium">
      Low Risk
    </Badge>
  );
}

function StatusBadge({ status }: { status: InterventionStatus }) {
  if (status === "resolved")
    return (
      <Badge variant="secondary" className="bg-success/10 text-success hover:bg-success/20">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Resolved
      </Badge>
    );
  if (status === "in-progress")
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">
        <Play className="w-3 h-3 mr-1" />
        In Progress
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-warning/10 text-warning hover:bg-warning/20">
      <Clock className="w-3 h-3 mr-1" />
      Pending
    </Badge>
  );
}

function InterventionsDashboard() {
  const queryClient = useQueryClient();
  const [classId, setClassId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [classes, setClasses] = useState<DbClass[]>([]);

  useEffect(() => {
    classRepository.findAll().then(setClasses);
  }, []);

  const {
    data: interventions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["interventions", classId, statusFilter, riskFilter],
    queryFn: () => {
      const filters: { status?: string; classId?: string; riskLevel?: string } = {};
      if (classId !== "all") filters.classId = classId;
      if (statusFilter !== "all") filters.status = statusFilter;
      if (riskFilter !== "all") filters.riskLevel = riskFilter;
      return interventionService.getInterventions(filters);
    },
  });

  const runEngineMutation = useMutation({
    mutationFn: () => interventionService.runInterventionEngine(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
      toast.success("Intervention engine completed", {
        description: `Created ${result.created} new interventions. Notified ${result.notified} parents.`,
      });
    },
    onError: () => {
      toast.error("Failed to run intervention engine");
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InterventionStatus }) =>
      interventionService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
      toast.success("Intervention status updated");
    },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-[1400px] mx-auto">
      <PageHeader
        title="Automated Interventions"
        description="Review and manage student interventions triggered by attendance drops."
        actions={
          <Button
            onClick={() => runEngineMutation.mutate()}
            disabled={runEngineMutation.isPending}
            className="shadow-sm"
          >
            {runEngineMutation.isPending ? "Running..." : "Run Engine Now"}
          </Button>
        }
      />

      <Card className="glass-panel">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="space-y-2 flex-1 w-full">
              <Label className="flex items-center gap-2">
                <Filter className="w-4 h-4" /> Class Filter
              </Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 w-full">
              <Label>Risk Level</Label>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Risks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risks</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 w-full">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="card-elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Active Interventions
          </CardTitle>
          <CardDescription>Monitor students requiring immediate faculty attention.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center p-8 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-2" />
              <p>Failed to load interventions.</p>
            </div>
          ) : !interventions || interventions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground opacity-70">
              <CheckCircle2 className="h-12 w-12 mb-3 text-success/70" />
              <p className="text-lg font-medium">All caught up!</p>
              <p className="text-sm">No interventions match your filters.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <div className="grid grid-cols-12 bg-muted/50 p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="col-span-3">Student</div>
                <div className="col-span-3">Reason</div>
                <div className="col-span-2 text-center">Risk</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              <div className="divide-y">
                {interventions.map((intervention) => (
                  <div
                    key={intervention.id}
                    className="grid grid-cols-12 p-3 text-sm items-center hover:bg-muted/30 transition-colors"
                  >
                    <div className="col-span-3 min-w-0 pr-4">
                      <p className="font-medium truncate">{intervention.studentName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {intervention.className}
                      </p>
                    </div>
                    <div className="col-span-3 pr-4">
                      <p className="text-muted-foreground truncate" title={intervention.reason}>
                        {intervention.reason}
                      </p>
                      <p className="text-[10px] text-muted-foreground opacity-70">
                        {new Date(intervention.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <RiskBadge level={intervention.riskLevel} />
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <StatusBadge status={intervention.status} />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Select
                        value={intervention.status}
                        onValueChange={(val: InterventionStatus) =>
                          updateStatusMutation.mutate({ id: intervention.id, status: val })
                        }
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="in-progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
