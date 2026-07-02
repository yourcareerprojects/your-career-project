import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import { useTranslation } from 'react-i18next';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import {
  coachingChatInputAreaSx,
  coachingChatRootSx,
  coachingChatPageRootSx,
  coachingChatDialogRootSx,
  useCoachingChatAutoScroll,
} from '../../hooks/useCoachingChatAutoScroll';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';

async function postWorkEnjoyCoaching({ seniority, messages, lang, token, cvContext }) {
  const res = await fetch(`/api/profile/work-enjoy-coaching?${getProfileApiLangQuery()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      seniority,
      messages,
      lang,
      ...(cvContext ? { cvContext } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.details || 'Coaching request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

const WORK_ENJOY_ACTIVITY_COUNT = 5;

function parseActivitiesFromText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function formatActivitiesAsText(activities) {
  return activities.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
}

function normalizeActivityDrafts(drafts, targetCount = WORK_ENJOY_ACTIVITY_COUNT) {
  const cleaned = drafts.map((item) => String(item || '').trim());
  while (cleaned.length < targetCount) cleaned.push('');
  return cleaned.slice(0, targetCount);
}

/**
 * Numbered list of work activities with optional edit mode.
 * @param {{
 *   activities: string[],
 *   onActivitiesChange?: (activities: string[]) => void,
 *   onUserEdited?: () => void,
 *   introText?: string,
 *   showConfirm?: boolean,
 *   confirmCta?: string,
 *   onConfirm?: () => void,
 * }} props
 */
export function WorkEnjoyActivitiesPanel({
  activities,
  onActivitiesChange,
  onUserEdited,
  onEditingChange,
  introText,
  showConfirm = false,
  confirmCta,
  onConfirm,
  onRestartChat,
}) {
  const { t } = useTranslation('onboarding');
  const [editing, setEditing] = useState(false);
  const [editDrafts, setEditDrafts] = useState([]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const startEditing = () => {
    const base = activities.length > 0
      ? activities
      : normalizeActivityDrafts([]);
    setEditDrafts(normalizeActivityDrafts(base));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditDrafts([]);
  };

  const saveEditing = () => {
    const cleaned = editDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    onActivitiesChange?.(cleaned);
    onUserEdited?.();
    setEditing(false);
    setEditDrafts([]);
  };

  const canEdit = typeof onActivitiesChange === 'function';

  return (
    <Box>
      {introText ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {introText}
        </Typography>
      ) : null}
      {editing ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          {editDrafts.map((activity, idx) => (
            <TextField
              key={`edit-${idx}`}
              fullWidth
              size="small"
              hiddenLabel
              value={activity}
              onChange={(e) => {
                const next = [...editDrafts];
                next[idx] = e.target.value;
                setEditDrafts(next);
              }}
              sx={{ mb: idx < editDrafts.length - 1 ? 1.5 : 0 }}
            />
          ))}
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <List dense disablePadding>
            {activities.map((activity, idx) => (
              <ListItem key={`${idx}-${activity}`} disableGutters sx={{ py: 0.75 }}>
                <ListItemText primary={`${idx + 1}. ${activity}`} />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {canEdit && !editing ? (
          <>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={startEditing}>
              {t('profilePage.actions.edit', { ns: 'onboarding' })}
            </Button>
            {onRestartChat ? (
              <Button variant="outlined" startIcon={<ReplayIcon />} onClick={onRestartChat}>
                {t('profilePage.actions.restartCoachingChat', { ns: 'onboarding' })}
              </Button>
            ) : null}
          </>
        ) : null}
        {editing ? (
          <>
            <Button variant="contained" onClick={saveEditing}>
              {t('profilePage.actions.save', { ns: 'onboarding' })}
            </Button>
            <Button variant="text" onClick={cancelEditing}>
              {t('profilePage.actions.cancel', { ns: 'onboarding' })}
            </Button>
          </>
        ) : null}
        {showConfirm && !editing ? (
          <Button
            variant="contained"
            onClick={onConfirm}
            disabled={activities.length === 0}
          >
            {confirmCta}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * LLM-guided chat for workEnjoyMost during manual profile fill.
 * @param {{
 *   seniority: object,
 *   onComplete: (activities: string[], workEnjoyMostText: string, meta?: { userEdited?: boolean }) => void,
 *   initialActivities?: string[],
 *   initialMessages?: { role: string, content: string }[],
 *   onChatPersist?: (snapshot: object) => void,
 *   confirmInFooter?: boolean,
 *   onSummaryFooterStateChange?: (state: { canConfirm: boolean, isEditing: boolean, hasActivities: boolean }) => void,
 *   onBindConfirm?: (confirm: () => void) => void,
 *   cvContext?: object|null,
 * }} props
 */
const WorkEnjoyMostCoaching = ({
  seniority,
  onComplete,
  initialActivities = [],
  initialMessages = [],
  onChatPersist,
  confirmInFooter = false,
  onSummaryFooterStateChange,
  onBindConfirm,
  cvContext = null,
  layout = 'dialog',
}) => {
  const { t, i18n } = useTranslation('onboarding');
  const coachingLang = baseUILanguage() || String(i18n.language || 'de').toLowerCase().split('-')[0];
  const hasInitialSummary = initialActivities.length > 0;
  const hasInitialChat = initialMessages.length > 0;
  const [phase, setPhase] = useState(hasInitialSummary ? 'summary' : 'chat');
  const [messages, setMessages] = useState(initialMessages);
  const [activities, setActivities] = useState(initialActivities);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapped, setBootstrapped] = useState(hasInitialSummary || hasInitialChat);
  const [userEdited, setUserEdited] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const messagesRef = useRef(messages);
  const bootstrapStartedRef = useRef(false);
  const requestNextRef = useRef(null);
  const loadFailedMessageRef = useRef('');
  const chatInputReady = phase === 'chat' && bootstrapped && !loading;
  const {
    messagesScrollRef,
    messagesEndRef,
    inputAreaRef,
    inputRef,
    messagesScrollSx,
    scrollToBottom,
  } = useCoachingChatAutoScroll([messages, phase, loading, bootstrapped], {
    focusInputWhen: chatInputReady,
    layout,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!onChatPersist) return undefined;
    onChatPersist({
      phase,
      messages,
      activities,
      userEdited,
    });
    return undefined;
  }, [onChatPersist, phase, messages, activities, userEdited]);

  const requestNext = useCallback(async (history) => {
    const token = localStorage.getItem('token');
    const data = await postWorkEnjoyCoaching({
      seniority,
      messages: history,
      lang: coachingLang,
      token,
      cvContext,
    });
    if (data.phase === 'summary') {
      const nextActivities = Array.isArray(data.activities) ? data.activities : [];
      setActivities(nextActivities);
      setMessages([
        ...history,
        { role: 'assistant', content: data.message?.content || '' },
      ]);
      setPhase('summary');
      return;
    }
    const assistantMessage = data.message?.content?.trim();
    if (!assistantMessage) {
      throw new Error(t('workEnjoyCoaching.errors.emptyQuestion'));
    }
    setMessages([...history, { role: 'assistant', content: assistantMessage }]);
  }, [seniority, coachingLang, t, cvContext]);

  requestNextRef.current = requestNext;
  loadFailedMessageRef.current = t('workEnjoyCoaching.errors.loadFailed');

  useEffect(() => {
    if (bootstrapped || phase !== 'chat' || bootstrapStartedRef.current) return undefined;
    bootstrapStartedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        await requestNextRef.current([]);
        if (!cancelled) setBootstrapped(true);
      } catch (err) {
        if (!cancelled) {
          bootstrapStartedRef.current = false;
          setError(err.message || loadFailedMessageRef.current);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      bootstrapStartedRef.current = false;
      setLoading(false);
    };
  }, [bootstrapped, phase]);

  const handleSend = async () => {
    const answer = draft.trim();
    if (!answer || loading) return;
    const history = [...messagesRef.current, { role: 'user', content: answer }];
    setMessages(history);
    setDraft('');
    setLoading(true);
    setError('');
    try {
      await requestNext(history);
    } catch (err) {
      setError(err.message || t('workEnjoyCoaching.errors.sendFailed'));
      setMessages(messagesRef.current);
      setDraft(answer);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSummary = useCallback(() => {
    const cleaned = activities.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    onComplete(cleaned, formatActivitiesAsText(cleaned), { userEdited });
  }, [activities, onComplete, userEdited]);

  const handleRestartChat = useCallback(() => {
    bootstrapStartedRef.current = false;
    setPhase('chat');
    setMessages([]);
    setActivities([]);
    setDraft('');
    setError('');
    setUserEdited(false);
    setSummaryEditing(false);
    setBootstrapped(false);
  }, []);

  useEffect(() => {
    if (!onSummaryFooterStateChange) return undefined;
    if (phase !== 'summary') {
      onSummaryFooterStateChange({ canConfirm: false, isEditing: false, hasActivities: false });
      return undefined;
    }
    const hasActivities = activities.some((item) => String(item || '').trim());
    onSummaryFooterStateChange({
      canConfirm: true,
      isEditing: summaryEditing,
      hasActivities,
    });
    return undefined;
  }, [phase, activities, summaryEditing, onSummaryFooterStateChange]);

  useEffect(() => () => {
    onSummaryFooterStateChange?.({ canConfirm: false, isEditing: false, hasActivities: false });
  }, [onSummaryFooterStateChange]);

  useEffect(() => {
    if (!confirmInFooter || phase !== 'summary' || !onBindConfirm) return undefined;
    onBindConfirm(handleConfirmSummary);
    return undefined;
  }, [confirmInFooter, phase, onBindConfirm, handleConfirmSummary]);

  if (phase === 'summary') {
    return (
      <WorkEnjoyActivitiesPanel
        activities={activities}
        onActivitiesChange={setActivities}
        onUserEdited={() => setUserEdited(true)}
        onEditingChange={setSummaryEditing}
        introText={t('workEnjoyCoaching.summary.intro')}
        showConfirm={!confirmInFooter}
        confirmCta={t('workEnjoyCoaching.summary.confirmCta')}
        onConfirm={handleConfirmSummary}
        onRestartChat={handleRestartChat}
      />
    );
  }

  return (
    <Box sx={{
      ...coachingChatRootSx,
      ...(layout === 'page' ? coachingChatPageRootSx : coachingChatDialogRootSx),
    }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <Box ref={messagesScrollRef} sx={messagesScrollSx}>
        {messages.length === 0 && loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              {t('workEnjoyCoaching.chat.loading')}
            </Typography>
          </Box>
        )}
        {messages.map((msg, idx) => (
          <Box
            key={`${idx}-${msg.role}-${msg.content.slice(0, 24)}`}
            sx={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              mb: 1.5,
            }}
          >
            <Paper
              elevation={0}
              sx={{
                px: 1.5,
                py: 1,
                maxWidth: '85%',
                bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                borderRadius: 2,
                border: msg.role === 'user' ? 'none' : '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </Typography>
            </Paper>
          </Box>
        ))}
        {loading && messages.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              {t('workEnjoyCoaching.chat.thinking')}
            </Typography>
          </Box>
        )}
        <Box ref={messagesEndRef} sx={{ height: 0 }} aria-hidden />
      </Box>
      <Box ref={inputAreaRef} sx={coachingChatInputAreaSx}>
        <Divider sx={{ mb: 2, display: { xs: 'none', sm: 'block' } }} />
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('workEnjoyCoaching.chat.inputPlaceholder')}
            disabled={loading || !bootstrapped}
            onFocus={() => scrollToBottom({ smooth: false })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            variant="contained"
            onClick={() => void handleSend()}
            disabled={loading || !bootstrapped || !draft.trim()}
            endIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            sx={{
              flexShrink: 0,
              mt: { xs: 0, sm: 0.5 },
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            {t('workEnjoyCoaching.chat.sendCta')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export { parseActivitiesFromText, formatActivitiesAsText };
export default WorkEnjoyMostCoaching;
