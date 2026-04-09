/// <reference types="vite/client" />

import { useState, useRef, useEffect, useCallback } from "react";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useCampaignStore } from "../../store/campaignStore";
import { useApi } from "../../hooks/useApi";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  status: "pending" | "sent" | "failed" | "skipped";
}

interface CsvResult {
  imported: number;
  skipped: number;
  errors: { line: number; phone: string; reason: string }[];
}

const statusColor: Record<string, string> = {
  pending: "var(--text-tertiary)",
  sent: "var(--accent-green)",
  failed: "var(--accent-red)",
  skipped: "var(--text-secondary)",
};

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
};

export function ContactsModule() {
  const { activeCampaign, contacts, setContacts, updateCampaign } =
    useCampaignStore();
  const { get, post, del } = useApi();
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Modal estados
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isRunning = activeCampaign?.status === "running";

  // Carrega primeira página ao trocar de campanha
  useEffect(() => {
    if (!activeCampaign) return;
    setContacts([]);
    setPage(1);
    setHasMore(false);
    setCsvResult(null);
    get(`/api/campaigns/${activeCampaign.id}/contacts?page=1&limit=50`)
      .then((res) => {
        setContacts(res.data ?? []);
        setHasMore((res.page ?? 1) < (res.pages ?? 1));
        setPage(2);
      })
      .catch(() => {});
  }, [activeCampaign?.id]);

  const loadMore = useCallback(async () => {
    if (!activeCampaign || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await get(
        `/api/campaigns/${activeCampaign.id}/contacts?page=${page}&limit=50`
      );
      setContacts([...contacts, ...(res.data ?? [])]);
      setHasMore((res.page ?? page) < (res.pages ?? 1));
      setPage((p) => p + 1);
    } finally {
      setLoadingMore(false);
    }
  }, [activeCampaign?.id, page, hasMore, loadingMore, contacts]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (!activeCampaign) {
    return (
      <GlassCard
        padding="40px"
        style={{ textAlign: "center", color: "var(--text-secondary)" }}
      >
        Selecione ou crie uma campanha primeiro.
      </GlassCard>
    );
  }

  const campaignId = activeCampaign.id;

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const delimiter = text.includes(";") ? ";" : ",";
    const lines = text
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\n")
      .slice(0, 6);
    const headers = lines[0].split(delimiter).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => {
      const vals = l.split(delimiter).map((v) => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
    });
    setPreview(rows);
    setCsvResult(null);
  }

  async function confirmUpload() {
    if (!fileRef.current?.files?.[0]) return;
    setUploading(true);
    setCsvResult(null);
    const base = import.meta.env.VITE_API_URL ?? "";
    const formData = new FormData();
    formData.append("file", fileRef.current.files[0]);
    try {
      const res = await fetch(
        `${base}/api/campaigns/${campaignId}/contacts/upload`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        }
      );
      const data: CsvResult = await res.json();
      setCsvResult(data);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      const fresh = await get(
        `/api/campaigns/${campaignId}/contacts?page=1&limit=50`
      );
      setContacts(fresh.data ?? []);
      setPage(2);
      setHasMore((fresh.page ?? 1) < (fresh.pages ?? 1));
      updateCampaign(campaignId, { totalContacts: fresh.total ?? 0 });
    } finally {
      setUploading(false);
    }
  }

  async function addManual() {
    if (!manualPhone) return;
    setAdding(true);
    try {
      const contact = await post(`/api/campaigns/${campaignId}/contacts`, {
        name: manualName || undefined,
        phone: manualPhone,
      });
      setContacts([contact, ...contacts]);
      updateCampaign(campaignId, {
        totalContacts: (activeCampaign!.totalContacts ?? 0) + 1,
      });
      setManualName("");
      setManualPhone("");
    } catch (err: any) {
      alert(err.message ?? "Erro ao adicionar contato");
    } finally {
      setAdding(false);
    }
  }

  async function handleEdit(id: string, name: string | null, phone: string) {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL ?? ""}/api/campaigns/${campaignId}/contacts/${id}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? err.error ?? "Erro ao salvar");
    }
    const updated = await res.json();
    setContacts(contacts.map((c) => (c.id === id ? { ...c, ...updated } : c)));
  }

  async function handleDeleteOne(contact: Contact) {
    setDeletingId(contact.id);
    try {
      await del(`/api/campaigns/${campaignId}/contacts/${contact.id}`);
      setContacts(contacts.filter((c) => c.id !== contact.id));
      updateCampaign(campaignId, {
        totalContacts: Math.max(0, (activeCampaign!.totalContacts ?? 0) - 1),
      });
    } catch (err: any) {
      alert(err.message ?? "Erro ao excluir contato");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  async function handleDeleteAll() {
    setDeletingAll(true);
    try {
      await del(`/api/campaigns/${campaignId}/contacts`);
      setContacts([]);
      setPage(1);
      setHasMore(false);
      updateCampaign(campaignId, { totalContacts: 0 });
    } catch (err: any) {
      alert(err.message ?? "Erro ao excluir contatos");
    } finally {
      setDeletingAll(false);
      setShowDeleteAll(false);
    }
  }

  function downloadTemplate() {
    window.open(`/api/campaigns/${campaignId}/contacts/template`, "_blank");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Contatos</h2>
        <p
          style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}
        >
          Campanha: <strong>{activeCampaign.name}</strong>
        </p>
      </div>

      {/* Upload CSV */}
      <GlassCard>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Upload CSV</h3>
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            Baixar modelo
          </Button>
        </div>

        <label
          style={{
            display: "block",
            border: "2px dashed var(--glass-border)",
            borderRadius: "var(--radius-md)",
            padding: "24px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleCSV}
            style={{ display: "none" }}
          />
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Clique para selecionar ou arraste o CSV
          </p>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-tertiary)",
              marginTop: 4,
            }}
          >
            Colunas: <code>nome, telefone</code>
          </p>
        </label>

        {preview && preview.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 10,
              }}
            >
              Preview (primeiras linhas):
            </p>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  fontSize: 13,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr>
                    {Object.keys(preview[0]).map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "6px 10px",
                          textAlign: "left",
                          color: "var(--text-secondary)",
                          borderBottom: "1px solid var(--glass-border)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val: any, j) => (
                        <td
                          key={j}
                          style={{
                            padding: "6px 10px",
                            borderBottom: "1px solid var(--glass-border)",
                          }}
                        >
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <Button onClick={confirmUpload} loading={uploading}>
                Importar contatos
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Resultado do CSV */}
        {csvResult && (
          <CsvResultBanner
            result={csvResult}
            onClose={() => setCsvResult(null)}
          />
        )}
      </GlassCard>

      {/* Adicionar manualmente */}
      <GlassCard>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          Adicionar Manualmente
        </h3>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Nome (opcional)"
              placeholder="João Silva"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              label="Telefone (formato internacional)"
              placeholder="+5548999990001"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
            />
          </div>
          <Button onClick={addManual} disabled={!manualPhone} loading={adding}>
            Adicionar
          </Button>
        </div>
      </GlassCard>

      {/* Resumo */}
      <div
        style={{
          padding: "12px 16px",
          background: "rgba(10,132,255,0.08)",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          color: "var(--accent)",
        }}
      >
        Total:{" "}
        <strong>{activeCampaign.totalContacts ?? contacts.length}</strong>{" "}
        contatos nesta campanha
      </div>

      {/* Lista de contatos */}
      {contacts.length > 0 && (
        <GlassCard padding="0">
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--glass-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Lista de Contatos</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                {contacts.length} de{" "}
                {activeCampaign.totalContacts ?? contacts.length}
              </span>
              <button
                onClick={() => setShowDeleteAll(true)}
                disabled={isRunning}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,69,58,0.3)",
                  borderRadius: 6,
                  color: isRunning
                    ? "var(--text-tertiary)"
                    : "var(--accent-red)",
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "3px 8px",
                  cursor: isRunning ? "not-allowed" : "pointer",
                  opacity: isRunning ? 0.4 : 1,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isRunning)
                    (e.currentTarget as HTMLElement).style.background =
                      "rgba(255,69,58,0.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "none";
                }}
              >
                Excluir todos
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: 480,
              overflowY: "auto",
              overflowX: "hidden",
              scrollbarWidth: "thin",
              scrollbarColor: "var(--glass-border) transparent",
            }}
          >
            {contacts.map((c, i) => (
              <ContactRow
                key={c.id ?? i}
                contact={c}
                isLast={i === contacts.length - 1 && !hasMore}
                deleting={deletingId === c.id}
                onEdit={handleEdit}
                onDelete={() => setDeleteTarget(c)}
              />
            ))}

            <div ref={sentinelRef} style={{ height: 1 }} />

            {loadingMore && (
              <div
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <SpinnerSVG />
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  Carregando mais...
                </span>
              </div>
            )}

            {!hasMore && !loadingMore && contacts.length > 0 && (
              <div
                style={{
                  padding: "10px 16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                  borderTop: "1px solid var(--glass-border)",
                }}
              >
                Todos os contatos carregados
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Modal — excluir individual */}
      {deleteTarget && (
        <ConfirmModal
          title="Excluir contato?"
          description={`${deleteTarget.name || deleteTarget.phone} ${deleteTarget.name ? `(${deleteTarget.phone})` : ""}\nEsta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          loading={deletingId === deleteTarget.id}
          onConfirm={() => handleDeleteOne(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Modal — excluir todos */}
      {showDeleteAll && (
        <ConfirmModal
          title="Excluir todos os contatos?"
          description={`Você está prestes a remover ${activeCampaign.totalContacts ?? contacts.length} contatos da campanha "${activeCampaign.name}".\nEsta ação não pode ser desfeita.`}
          confirmLabel="Excluir Todos"
          loading={deletingAll}
          onConfirm={handleDeleteAll}
          onCancel={() => setShowDeleteAll(false)}
        />
      )}
    </div>
  );
}

// ── ContactRow ────────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  isLast,
  deleting,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  isLast: boolean;
  deleting: boolean;
  onEdit: (id: string, name: string | null, phone: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(contact.name ?? "");
  const [editPhone, setEditPhone] = useState(contact.phone);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const initials = (contact.name || contact.phone).slice(0, 2).toUpperCase();
  const isSent = contact.status === "sent";

  async function save() {
    setSaving(true);
    setEditError(null);
    try {
      await onEdit(contact.id, editName || null, editPhone);
      setEditing(false);
    } catch (err: any) {
      setEditError(err.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setEditName(contact.name ?? "");
    setEditPhone(contact.phone);
    setEditError(null);
  }

  if (editing) {
    return (
      <div
        style={{
          padding: "10px 16px",
          borderBottom: isLast ? "none" : "1px solid var(--glass-border)",
          background: "rgba(10,132,255,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Nome (opcional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            style={{
              flex: 1,
              minWidth: 100,
              padding: "6px 10px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--glass-border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <input
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            placeholder="+5548999990001"
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            style={{
              flex: 1,
              minWidth: 140,
              padding: "6px 10px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--glass-border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={save}
            disabled={saving || !editPhone}
            style={actionBtnStyle(false)}
            title="Salvar"
          >
            {saving ? <SpinnerSVG /> : "✓"}
          </button>
          <button
            onClick={cancel}
            style={actionBtnStyle(false)}
            title="Cancelar"
          >
            ✕
          </button>
        </div>
        {editError && (
          <p style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 6 }}>
            {editError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: isLast ? "none" : "1px solid var(--glass-border)",
        fontSize: 13,
        transition: "background 0.15s",
        opacity: deleting ? 0.4 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-secondary)",
          flexShrink: 0,
          letterSpacing: 0.5,
        }}
      >
        {initials}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {contact.name || contact.phone}
        </div>
        {contact.name && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {contact.phone}
          </div>
        )}
      </div>

      <span
        style={{
          fontSize: 11,
          flexShrink: 0,
          color: statusColor[contact.status] ?? "var(--text-tertiary)",
          fontWeight: 500,
        }}
      >
        {statusLabel[contact.status] ?? contact.status}
      </span>

      {/* Botões de ação — visíveis no hover (desktop) ou sempre (mobile) */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexShrink: 0,
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      >
        <button
          onClick={() => {
            if (!isSent) setEditing(true);
          }}
          disabled={isSent}
          title={isSent ? "Não é possível editar contato já enviado" : "Editar"}
          style={actionBtnStyle(false, isSent)}
        >
          <EditSVG />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          title="Excluir"
          style={actionBtnStyle(true)}
        >
          <TrashSVG />
        </button>
      </div>
    </div>
  );
}

function actionBtnStyle(
  isDanger: boolean,
  disabled = false
): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.07)",
    border: `1px solid ${isDanger ? "rgba(255,69,58,0.2)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 6,
    color: isDanger ? "var(--accent-red)" : "var(--text-secondary)",
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
    padding: 0,
    transition: "background 0.15s",
    flexShrink: 0,
  };
}

// ── CsvResultBanner ───────────────────────────────────────────────────────────

function CsvResultBanner({
  result,
  onClose,
}: {
  result: CsvResult;
  onClose: () => void;
}) {
  const formatErrors = result.errors.filter(
    (e) => e.reason !== "Already exists in campaign"
  );

  return (
    <div
      style={{
        marginTop: 12,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--glass-border)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      {/* Linha de sucesso */}
      {result.imported > 0 && (
        <div
          style={{
            padding: "8px 14px",
            background: "rgba(48,209,88,0.1)",
            color: "var(--accent-green)",
            display: "flex",
            gap: 8,
          }}
        >
          <span>✅</span>
          <span>
            <strong>{result.imported}</strong> contatos importados
          </span>
        </div>
      )}
      {/* Ignorados */}
      {result.skipped > 0 && (
        <div
          style={{
            padding: "8px 14px",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text-secondary)",
            display: "flex",
            gap: 8,
          }}
        >
          <span>⏭️</span>
          <span>
            <strong>{result.skipped}</strong> ignorados (já existiam)
          </span>
        </div>
      )}
      {/* Erros de formato */}
      {formatErrors.map((e, i) => (
        <div
          key={i}
          style={{
            padding: "6px 14px",
            background: "rgba(255,69,58,0.07)",
            color: "var(--accent-red)",
            display: "flex",
            gap: 8,
          }}
        >
          <span>❌</span>
          <span>
            Linha {e.line}
            {e.phone ? ` — ${e.phone}` : ""}: {e.reason}
          </span>
        </div>
      ))}
      {/* Fechar */}
      <div
        style={{
          padding: "6px 14px",
          display: "flex",
          justifyContent: "flex-end",
          borderTop: "1px solid var(--glass-border)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          maxWidth: 380,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          {title}
        </h3>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            whiteSpace: "pre-line",
            marginBottom: 20,
          }}
        >
          {description}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── SVGs ──────────────────────────────────────────────────────────────────────

function EditSVG() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashSVG() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function SpinnerSVG() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      style={{ animation: "spin 0.8s linear infinite", color: "currentColor" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="20"
        strokeDashoffset="10"
      />
    </svg>
  );
}
