import { memo, useState } from "react";
import { Check, Copy, Pencil, RefreshCw } from "lucide-react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { useI18n } from "../../components/useI18n";
import type { Attachment, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
  );
});

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onRegenerate?: () => void;
  onEdit?: (messageId: string, text: string) => void;
}

/** Messages the user can edit and resend (not slash-command echoes). */
function isEditable(msg: ChatMessage): boolean {
  return (
    msg.role === "user" &&
    msg.id.startsWith("user-") &&
    !/^user-(btw|approve|deny)-/.test(msg.id) &&
    !msg.content.startsWith("/")
  );
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  onRegenerate,
  onEdit,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const copyMessage = (): void => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const startEdit = (): void => { setDraft(msg.content); setEditing(true); };
  const saveEdit = (): void => {
    if (!draft.trim()) return;
    setEditing(false);
    onEdit?.(msg.id, draft);
  };
  const showRegenerate = msg.role === "agent" && isLast && !isLoading && !!onRegenerate;
  const showEdit = isEditable(msg) && !isLoading && !!onEdit;
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(
    null,
  );
  const showApprovalBar =
    msg.role === "agent" &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;

  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}
      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onPreview={(a) => a.kind === "image" && setPreviewAttachment(a)}
              />
            ))}
          </div>
        )}
        {editing ? (
          <div className="chat-edit">
            <textarea
              className="chat-edit-input"
              value={draft}
              autoFocus
              rows={Math.min(10, Math.max(2, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="chat-edit-actions">
              <button className="btn btn-secondary chat-edit-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary chat-edit-btn" onClick={saveEdit} disabled={!draft.trim()}>Send</button>
            </div>
          </div>
        ) : (
          msg.content &&
          (msg.role === "agent" ? (
            <AgentMarkdown>{msg.content}</AgentMarkdown>
          ) : (
            msg.content
          ))
        )}
      </div>
      {!editing && msg.content && (
        <div className={`chat-msg-actions chat-msg-actions-${msg.role}`}>
          <button className="chat-msg-action" onClick={copyMessage} title="Copy">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {showEdit && (
            <button className="chat-msg-action" onClick={startEdit} title="Edit and resend">
              <Pencil size={13} />
            </button>
          )}
          {showRegenerate && (
            <button className="chat-msg-action" onClick={onRegenerate} title="Regenerate">
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
      {previewAttachment && previewAttachment.dataUrl && (
        <div
          className="chat-image-preview-backdrop"
          onClick={() => setPreviewAttachment(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={previewAttachment.dataUrl}
            alt={previewAttachment.name}
            className="chat-image-preview-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
