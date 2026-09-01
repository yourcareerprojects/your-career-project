import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  coachingChatComposerSx,
  coachingChatRootSx,
  coachingChatPageRootSx,
  coachingChatDialogRootSx,
  useDebouncedCoachingPersist,
  useCoachingChatAutoScroll,
} from '../../hooks/useCoachingChatAutoScroll';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import CoachingChatFailureAlert from './CoachingChatFailureAlert';

const CAREER_GOAL_COUNT = 5;
const PRIORITY_COUNT = 5;

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

function normalizeEmptyDrafts(items, targetCount) {
  const filled = draftsFromFilledItems(items);
  if (filled.length > 0) return filled;
  return Array.from({ length: targetCount }, () => '');
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
  initialEditing = false,
}) {
  const { t } = useTranslation('onboarding');
  const [editing, setEditing] = useState(Boolean(initialEditing));
  const [goalDrafts, setGoalDrafts] = useState(() => (
    initialEditing ? normalizeEmptyDrafts(careerGoals, CAREER_GOAL_COUNT) : []
  ));
  const [priorityDrafts, setPriorityDrafts] = useState(() => (
    initialEditing ? normalizeEmptyDrafts(priorities, PRIORITY_COUNT) : []
  ));

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const canEdit = typeof onSummaryChange === 'function';

  const startEditing = () => {
    setGoalDrafts(normalizeEmptyDrafts(careerGoals, CAREER_GOAL_COUNT));
    setPriorityDrafts(normalizeEmptyDrafts(priorities, PRIORITY_COUNT));
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
              multiline
              minRows={2}
              maxRows={6}
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
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          {label}
        </Typography>
        <List dense disablePadding>
          {visibleItems.map((item, idx) => (
            <ListItem key={`${label}-${idx}-${item}`} disableGutters sx={{ py: 0.25 }}>
              <ListItemText
                primary={`${idx + 1}. ${item}`}
                primaryTypographyProps={{ variant: 'body2' }}
              />
            </ListItem>
          ))}
        </List>
      </Box>
    );
  };

  return (
    <Box>
      {introText ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: { xs: 1, sm: 2 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
        >
          {introText}
        </Typography>
      ) : null}
      <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 }, mb: { xs: 1.25, sm: 2 } }}>
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {canEdit && !editing ? (
          <>
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={startEditing}>
              {t('profilePage.actions.edit', { ns: 'onboarding' })}
            </Button>
            {onRestartChat ? (
              <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={onRestartChat}>
                {t('profilePage.actions.restartCoachingChat', { ns: 'onboarding' })}
              </Button>
            ) : null}
          </>
        ) : null}
        {editing ? (
          <>
            <Button size="small" variant="contained" onClick={saveEditing}>
              {t('profilePage.actions.save', { ns: 'onboarding' })}
            </Button>
            <Button size="small" variant="text" onClick={cancelEditing}>
              {t('profilePage.actions.cancel', { ns: 'onboarding' })}
            </Button>
          </>
        ) : null}
        {showConfirm && !editing ? (
          <Button
            size="small"
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
  initialManualEntry = false,
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
  const startInManualEntry = Boolean(initialManualEntry) && !hasInitialSummary;
  const [phase, setPhase] = useState(hasInitialSummary || startInManualEntry ? 'summary' : 'chat');
  const [messages, setMessages] = useState(initialMessages);
  const [careerGoals, setCareerGoals] = useState(initialCareerGoals);
  const [priorities, setPriorities] = useState(initialPriorities);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapped, setBootstrapped] = useState(hasInitialSummary || hasInitialChat || startInManualEntry);
  const [userEdited, setUserEdited] = useState(Boolean(initialManualEntry));
  const [manualEntry, setManualEntry] = useState(Boolean(initialManualEntry));
  const [summaryEditing, setSummaryEditing] = useState(startInManualEntry);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
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
    inputAreaSx,
    scrollToBottom,
  } = useCoachingChatAutoScroll([messages, phase, loading, bootstrapped], {
    focusInputWhen: phase === 'chat' && bootstrapped && !loading,
    layout,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useDebouncedCoachingPersist(onChatPersist, {
    phase,
    messages,
    careerGoals,
    priorities,
    userEdited,
    manualEntry,
  });

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
  }, [bootstrapped, phase, bootstrapNonce]);

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

  const handleRetryCoaching = useCallback(() => {
    setError('');
    if (!bootstrapped && messagesRef.current.length === 0) {
      bootstrapStartedRef.current = false;
      setBootstrapNonce((n) => n + 1);
    }
  }, [bootstrapped]);

  const handleEnterManually = useCallback(() => {
    setError('');
    setLoading(false);
    setDraft('');
    setMessages([]);
    setCareerGoals([]);
    setPriorities([]);
    setUserEdited(true);
    setManualEntry(true);
    setSummaryEditing(true);
    setBootstrapped(true);
    setPhase('summary');
  }, []);

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
    setManualEntry(false);
    setSummaryEditing(false);
    setBootstrapped(false);
    setBootstrapNonce((n) => n + 1);
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
        introText={manualEntry
          ? t('coachingFallback.manualIntro')
          : t('workingLifeAchievementCoaching.summary.intro')}
        showConfirm={!confirmInFooter}
        confirmCta={t('workingLifeAchievementCoaching.summary.confirmCta')}
        onConfirm={handleConfirmSummary}
        onRestartChat={handleRestartChat}
        initialEditing={manualEntry && careerGoals.length === 0 && priorities.length === 0}
      />
    );
  }

  return (
    <Box sx={{
      ...coachingChatRootSx,
      ...(layout === 'page' ? coachingChatPageRootSx : coachingChatDialogRootSx),
    }}>
      <CoachingChatFailureAlert
        error={error}
        loading={loading}
        onDismiss={() => setError('')}
        onRetry={!bootstrapped ? handleRetryCoaching : undefined}
        onEnterManually={handleEnterManually}
      />
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
              mb: { xs: 1, sm: 1.5 },
            }}
          >
            <Paper
              elevation={0}
              sx={{
                px: { xs: 1.25, sm: 1.5 },
                py: { xs: 0.875, sm: 1 },
                maxWidth: { xs: '92%', sm: '85%' },
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
      <Box ref={inputAreaRef} sx={inputAreaSx}>
        <Divider sx={{ mb: { xs: 0.75, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
        <Box sx={coachingChatComposerSx}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            minRows={1}
            maxRows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('workingLifeAchievementCoaching.chat.inputPlaceholder')}
            disabled={loading || !bootstrapped}
            size="small"
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
              minHeight: { xs: 40, sm: 'auto' },
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
