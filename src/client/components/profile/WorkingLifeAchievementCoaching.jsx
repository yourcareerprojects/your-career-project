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
  useCoachingChatAutoScroll,
} from '../../hooks/useCoachingChatAutoScroll';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';

const CAREER_GOAL_COUNT = 5;

async function postWorkingLifeAchievementCoaching({ seniority, messages, lang, token, cvContext }) {
  const res = await fetch(`/api/profile/working-life-achievement-coaching?${getProfileApiLangQuery()}`, {
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

function draftsFromFilledItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function parseLinesFromBlock(block) {
  return String(block || '')
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function parseWorkingLifeAchievementFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { careerGoals: [], priorities: [] };
  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    return {
      careerGoals: parseLinesFromBlock(blocks[0]),
      priorities: parseLinesFromBlock(blocks[1]),
    };
  }
  const lines = parseLinesFromBlock(raw);
  return {
    careerGoals: lines.slice(0, CAREER_GOAL_COUNT),
    priorities: lines.slice(CAREER_GOAL_COUNT),
  };
}

function parseCareerGoalsFromText(text) {
  return parseWorkingLifeAchievementFromText(text).careerGoals;
}

function formatWorkingLifeAchievementAsText({ careerGoals = [], priorities = [] } = {}) {
  const goalLines = careerGoals.map((item) => String(item || '').trim()).filter(Boolean);
  const priorityLines = priorities.map((item) => String(item || '').trim()).filter(Boolean);
  if (goalLines.length === 0 && priorityLines.length === 0) return '';
  if (priorityLines.length === 0) return goalLines.join('\n');
  return `${goalLines.join('\n')}\n\n${priorityLines.join('\n')}`;
}

/**
 * Summary panel with editable career goals and priorities.
 */
export function WorkingLifeAchievementSummaryPanel({
  careerGoals = [],
  priorities = [],
  onSummaryChange,
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
  const [goalDrafts, setGoalDrafts] = useState([]);
  const [priorityDrafts, setPriorityDrafts] = useState([]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const canEdit = typeof onSummaryChange === 'function';

  const startEditing = () => {
    setGoalDrafts(draftsFromFilledItems(careerGoals));
    setPriorityDrafts(draftsFromFilledItems(priorities));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setGoalDrafts([]);
    setPriorityDrafts([]);
  };

  const saveEditing = () => {
    const cleanedGoals = goalDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedPriorities = priorityDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleanedGoals.length === 0 || cleanedPriorities.length === 0) return;
    onSummaryChange?.({ careerGoals: cleanedGoals, priorities: cleanedPriorities });
    onUserEdited?.();
    setEditing(false);
    setGoalDrafts([]);
    setPriorityDrafts([]);
  };

  const renderList = (items, drafts, setDrafts, label) => {
    const visibleItems = draftsFromFilledItems(items);
    if (editing) {
      if (drafts.length === 0) return null;
      return (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {label}
          </Typography>
          {drafts.map((item, idx) => (
            <TextField
              key={`${label}-${idx}`}
              fullWidth
              size="small"
              hiddenLabel
              value={item}
              onChange={(e) => {
                const next = [...drafts];
                next[idx] = e.target.value;
                setDrafts(next);
              }}
              sx={{ mb: idx < drafts.length - 1 ? 1.5 : 0 }}
            />
          ))}
        </Box>
      );
    }
    if (visibleItems.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {label}
        </Typography>
        <List dense disablePadding>
          {visibleItems.map((item, idx) => (
            <ListItem key={`${label}-${idx}-${item}`} disableGutters sx={{ py: 0.5 }}>
              <ListItemText primary={`${idx + 1}. ${item}`} />
            </ListItem>
          ))}
        </List>
      </Box>
    );
  };

  return (
    <Box>
      {introText ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {introText}
        </Typography>
      ) : null}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        {renderList(
          careerGoals,
          goalDrafts,
          setGoalDrafts,
          t('workingLifeAchievementCoaching.summary.careerGoalsHeading')
        )}
        {renderList(
          priorities,
          priorityDrafts,
          setPriorityDrafts,
          t('workingLifeAchievementCoaching.summary.prioritiesHeading')
        )}
      </Paper>
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
            disabled={careerGoals.length === 0 || priorities.length === 0}
          >
            {confirmCta}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * LLM-guided chat for workingLifeAchievement during manual profile fill.
 */
const WorkingLifeAchievementCoaching = ({
  seniority,
  onComplete,
  initialCareerGoals = [],
  initialPriorities = [],
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
  const hasInitialSummary = initialCareerGoals.length > 0 || initialPriorities.length > 0;
  const hasInitialChat = initialMessages.length > 0;
  const [phase, setPhase] = useState(hasInitialSummary ? 'summary' : 'chat');
  const [messages, setMessages] = useState(initialMessages);
  const [careerGoals, setCareerGoals] = useState(initialCareerGoals);
  const [priorities, setPriorities] = useState(initialPriorities);
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
  const {
    messagesScrollRef,
    messagesEndRef,
    inputAreaRef,
    inputRef,
    messagesScrollSx,
    scrollToBottom,
  } = useCoachingChatAutoScroll([messages, phase, loading, bootstrapped], {
    focusInputWhen: phase === 'chat' && bootstrapped && !loading,
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
      careerGoals,
      priorities,
      userEdited,
    });
    return undefined;
  }, [onChatPersist, phase, messages, careerGoals, priorities, userEdited]);

  const requestNext = useCallback(async (history) => {
    const token = localStorage.getItem('token');
    const data = await postWorkingLifeAchievementCoaching({
      seniority,
      messages: history,
      lang: coachingLang,
      token,
      cvContext,
    });
    if (data.phase === 'summary') {
      const nextGoals = Array.isArray(data.careerGoals) ? data.careerGoals : [];
      const nextPriorities = Array.isArray(data.priorities) ? data.priorities : [];
      setCareerGoals(nextGoals);
      setPriorities(nextPriorities);
      setMessages([
        ...history,
        { role: 'assistant', content: data.message?.content || '' },
      ]);
      setPhase('summary');
      return;
    }
    const assistantMessage = data.message?.content?.trim();
    if (!assistantMessage) {
      throw new Error(t('workingLifeAchievementCoaching.errors.emptyQuestion'));
    }
    setMessages([...history, { role: 'assistant', content: assistantMessage }]);
  }, [seniority, coachingLang, t, cvContext]);

  requestNextRef.current = requestNext;
  loadFailedMessageRef.current = t('workingLifeAchievementCoaching.errors.loadFailed');

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
      setError(err.message || t('workingLifeAchievementCoaching.errors.sendFailed'));
      setMessages(messagesRef.current);
      setDraft(answer);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSummary = useCallback(() => {
    const cleanedGoals = careerGoals.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedPriorities = priorities.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleanedGoals.length === 0 || cleanedPriorities.length === 0) return;
    const summary = { careerGoals: cleanedGoals, priorities: cleanedPriorities };
    onComplete(summary, formatWorkingLifeAchievementAsText(summary), { userEdited });
  }, [careerGoals, priorities, onComplete, userEdited]);

  const handleRestartChat = useCallback(() => {
    bootstrapStartedRef.current = false;
    setPhase('chat');
    setMessages([]);
    setCareerGoals([]);
    setPriorities([]);
    setDraft('');
    setError('');
    setUserEdited(false);
    setSummaryEditing(false);
    setBootstrapped(false);
  }, []);

  useEffect(() => {
    if (!onSummaryFooterStateChange) return undefined;
    if (phase !== 'summary') {
      onSummaryFooterStateChange({ canConfirm: false, isEditing: false, hasSummary: false });
      return undefined;
    }
    const hasSummary = careerGoals.some((item) => String(item || '').trim())
      && priorities.some((item) => String(item || '').trim());
    onSummaryFooterStateChange({
      canConfirm: true,
      isEditing: summaryEditing,
      hasSummary,
    });
    return undefined;
  }, [phase, careerGoals, priorities, summaryEditing, onSummaryFooterStateChange]);

  useEffect(() => () => {
    onSummaryFooterStateChange?.({ canConfirm: false, isEditing: false, hasSummary: false });
  }, [onSummaryFooterStateChange]);

  useEffect(() => {
    if (!confirmInFooter || phase !== 'summary' || !onBindConfirm) return undefined;
    onBindConfirm(handleConfirmSummary);
    return undefined;
  }, [confirmInFooter, phase, onBindConfirm, handleConfirmSummary]);

  if (phase === 'summary') {
    return (
      <WorkingLifeAchievementSummaryPanel
        careerGoals={careerGoals}
        priorities={priorities}
        onSummaryChange={({ careerGoals: nextGoals, priorities: nextPriorities }) => {
          setCareerGoals(nextGoals);
          setPriorities(nextPriorities);
        }}
        onUserEdited={() => setUserEdited(true)}
        onEditingChange={setSummaryEditing}
        introText={t('workingLifeAchievementCoaching.summary.intro')}
        showConfirm={!confirmInFooter}
        confirmCta={t('workingLifeAchievementCoaching.summary.confirmCta')}
        onConfirm={handleConfirmSummary}
        onRestartChat={handleRestartChat}
      />
    );
  }

  return (
    <Box sx={{ ...coachingChatRootSx, ...(layout === 'page' ? coachingChatPageRootSx : {}) }}>
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
              {t('workingLifeAchievementCoaching.chat.loading')}
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
              {t('workingLifeAchievementCoaching.chat.thinking')}
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
            placeholder={t('workingLifeAchievementCoaching.chat.inputPlaceholder')}
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
            {t('workingLifeAchievementCoaching.chat.sendCta')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export {
  parseWorkingLifeAchievementFromText,
  parseCareerGoalsFromText,
  formatWorkingLifeAchievementAsText,
};
export default WorkingLifeAchievementCoaching;
