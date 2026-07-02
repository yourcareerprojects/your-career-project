import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  coachingChatComposerSx,
  coachingChatRootSx,
  coachingChatPageRootSx,
  coachingChatDialogRootSx,
  useDebouncedCoachingPersist,
  useCoachingChatAutoScroll,
} from '../../hooks/useCoachingChatAutoScroll';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import SkillDomainPicker from './SkillDomainPicker';
import SkillDomainChip from './SkillDomainChip';

const STRENGTH_COUNT = 5;
const SKILL_DOMAIN_MAX = 5;

async function postNaturallyGoodAtCoaching({ seniority, messages, lang, token, cvContext }) {
  const res = await fetch(`/api/profile/naturally-good-at-coaching?${getProfileApiLangQuery()}`, {
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

function normalizeListDrafts(drafts, targetCount) {
  const cleaned = drafts.map((item) => String(item || '').trim());
  while (cleaned.length < targetCount) cleaned.push('');
  return cleaned.slice(0, targetCount);
}

function parseLinesFromBlock(block) {
  return String(block || '')
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function parseNaturallyGoodAtFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { strengths: [] };
  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 1) {
    return {
      strengths: parseLinesFromBlock(blocks[0]),
    };
  }
  const lines = parseLinesFromBlock(raw);
  return {
    strengths: lines.slice(0, STRENGTH_COUNT),
  };
}

function parseStrengthsFromText(text) {
  return parseNaturallyGoodAtFromText(text).strengths;
}

function formatNaturallyGoodAtAsText({ strengths = [] } = {}) {
  return strengths.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
}

/**
 * Summary panel with editable strengths and skill domain selection.
 */
export function NaturallyGoodAtSummaryPanel({
  strengths = [],
  skillDomains = [],
  onSummaryChange,
  onUserEdited,
  onEditingChange,
  introText,
  showConfirm = false,
  confirmCta,
  onConfirm,
  recommendationContextTexts = [],
  onRestartChat,
}) {
  const { t } = useTranslation('onboarding');
  const [editing, setEditing] = useState(false);
  const [strengthDrafts, setStrengthDrafts] = useState([]);
  const [skillDomainDrafts, setSkillDomainDrafts] = useState([]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const canEdit = typeof onSummaryChange === 'function';

  const startEditing = () => {
    setStrengthDrafts(normalizeListDrafts(strengths.length > 0 ? strengths : [], STRENGTH_COUNT));
    setSkillDomainDrafts(skillDomains.length > 0 ? [...skillDomains] : []);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setStrengthDrafts([]);
    setSkillDomainDrafts([]);
  };

  const saveEditing = () => {
    const cleanedStrengths = strengthDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedDomains = skillDomainDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleanedStrengths.length === 0 || cleanedDomains.length === 0) return;
    onSummaryChange?.({ strengths: cleanedStrengths, skillDomains: cleanedDomains });
    onUserEdited?.();
    setEditing(false);
    setStrengthDrafts([]);
    setSkillDomainDrafts([]);
  };

  const renderStrengthList = (items, drafts, setDrafts, label) => {
    if (editing) {
      return (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
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
    if (items.length === 0) return null;
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          {label}
        </Typography>
        <List dense disablePadding>
          {items.map((item, idx) => (
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

  const renderSkillDomains = () => {
    if (editing) {
      return (
        <Box sx={{ mb: 2 }}>
          <SkillDomainPicker
            value={skillDomainDrafts}
            onChange={setSkillDomainDrafts}
            label={t('naturallyGoodAtCoaching.summary.skillDomainsHeading')}
            maxItems={SKILL_DOMAIN_MAX}
            recommendationContextTexts={recommendationContextTexts}
          />
        </Box>
      );
    }
    if (skillDomains.length === 0) return null;
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          {t('naturallyGoodAtCoaching.summary.skillDomainsHeading')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {skillDomains.map((item, idx) => (
            <SkillDomainChip key={`skill-domain-${idx}-${item}`} label={item} domainKey={item} />
          ))}
        </Box>
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
        {renderStrengthList(
          strengths,
          strengthDrafts,
          setStrengthDrafts,
          t('naturallyGoodAtCoaching.summary.strengthsHeading')
        )}
        {renderSkillDomains()}
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
            disabled={strengths.length === 0 || skillDomains.length === 0}
          >
            {confirmCta}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * LLM-guided chat for naturallyGoodAt during manual profile fill.
 */
const NaturallyGoodAtCoaching = ({
  seniority,
  onComplete,
  initialStrengths = [],
  initialSkillDomains = [],
  initialMessages = [],
  onChatPersist,
  confirmInFooter = false,
  onSummaryFooterStateChange,
  onBindConfirm,
  recommendationContextTexts = [],
  cvContext = null,
  layout = 'dialog',
}) => {
  const { t, i18n } = useTranslation('onboarding');
  const coachingLang = baseUILanguage() || String(i18n.language || 'de').toLowerCase().split('-')[0];
  const hasInitialSummary = initialStrengths.length > 0 || initialSkillDomains.length > 0;
  const hasInitialChat = initialMessages.length > 0;
  const [phase, setPhase] = useState(hasInitialSummary ? 'summary' : 'chat');
  const [messages, setMessages] = useState(initialMessages);
  const [strengths, setStrengths] = useState(initialStrengths);
  const [skillDomains, setSkillDomains] = useState(initialSkillDomains);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapped, setBootstrapped] = useState(hasInitialSummary || hasInitialChat);
  const [userEdited, setUserEdited] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const profileContextKey = useMemo(
    () => JSON.stringify(
      (Array.isArray(recommendationContextTexts) ? recommendationContextTexts : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ),
    [recommendationContextTexts]
  );
  const skillDomainRecommendationContext = useMemo(() => {
    const texts = [];
    try {
      const fromProfile = JSON.parse(profileContextKey);
      if (Array.isArray(fromProfile)) texts.push(...fromProfile);
    } catch {
      // ignore malformed context
    }
    strengths.forEach((item) => texts.push(String(item || '').trim()));
    messages
      .filter((msg) => msg?.role === 'user')
      .forEach((msg) => texts.push(String(msg.content || '').trim()));
    return texts.filter(Boolean);
  }, [profileContextKey, strengths, messages]);
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
    inputAreaSx,
    scrollToBottom,
  } = useCoachingChatAutoScroll([messages, phase, loading, bootstrapped], {
    focusInputWhen: chatInputReady,
    layout,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useDebouncedCoachingPersist(onChatPersist, {
    phase,
    messages,
    strengths,
    skillDomains,
    userEdited,
  });

  const requestNext = useCallback(async (history) => {
    const token = localStorage.getItem('token');
    const data = await postNaturallyGoodAtCoaching({
      seniority,
      messages: history,
      lang: coachingLang,
      token,
      cvContext,
    });
    if (data.phase === 'summary') {
      const nextStrengths = Array.isArray(data.strengths) ? data.strengths : [];
      const nextDomains = Array.isArray(data.skillDomains) ? data.skillDomains : [];
      setStrengths(nextStrengths);
      setSkillDomains(nextDomains);
      setMessages([
        ...history,
        { role: 'assistant', content: data.message?.content || '' },
      ]);
      setPhase('summary');
      return;
    }
    const assistantMessage = data.message?.content?.trim();
    if (!assistantMessage) {
      throw new Error(t('naturallyGoodAtCoaching.errors.emptyQuestion'));
    }
    setMessages([...history, { role: 'assistant', content: assistantMessage }]);
  }, [seniority, coachingLang, t, cvContext]);

  requestNextRef.current = requestNext;
  loadFailedMessageRef.current = t('naturallyGoodAtCoaching.errors.loadFailed');

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
      setError(err.message || t('naturallyGoodAtCoaching.errors.sendFailed'));
      setMessages(messagesRef.current);
      setDraft(answer);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSummary = useCallback(() => {
    const cleanedStrengths = strengths.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedDomains = skillDomains.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleanedStrengths.length === 0 || cleanedDomains.length === 0) return;
    const summary = { strengths: cleanedStrengths, skillDomains: cleanedDomains };
    onComplete(summary, formatNaturallyGoodAtAsText(summary), { userEdited });
  }, [strengths, skillDomains, onComplete, userEdited]);

  const handleRestartChat = useCallback(() => {
    bootstrapStartedRef.current = false;
    setPhase('chat');
    setMessages([]);
    setStrengths([]);
    setSkillDomains([]);
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
    const hasSummary = strengths.some((item) => String(item || '').trim())
      && skillDomains.some((item) => String(item || '').trim());
    onSummaryFooterStateChange({
      canConfirm: true,
      isEditing: summaryEditing,
      hasSummary,
    });
    return undefined;
  }, [phase, strengths, skillDomains, summaryEditing, onSummaryFooterStateChange]);

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
      <NaturallyGoodAtSummaryPanel
        strengths={strengths}
        skillDomains={skillDomains}
        onSummaryChange={({ strengths: nextStrengths, skillDomains: nextDomains }) => {
          setStrengths(nextStrengths);
          setSkillDomains(nextDomains);
        }}
        onUserEdited={() => setUserEdited(true)}
        onEditingChange={setSummaryEditing}
        introText={t('naturallyGoodAtCoaching.summary.intro')}
        showConfirm={!confirmInFooter}
        confirmCta={t('naturallyGoodAtCoaching.summary.confirmCta')}
        onConfirm={handleConfirmSummary}
        recommendationContextTexts={skillDomainRecommendationContext}
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
              {t('naturallyGoodAtCoaching.chat.loading')}
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
              {t('naturallyGoodAtCoaching.chat.thinking')}
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
            placeholder={t('naturallyGoodAtCoaching.chat.inputPlaceholder')}
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
            {t('naturallyGoodAtCoaching.chat.sendCta')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export {
  parseNaturallyGoodAtFromText,
  parseStrengthsFromText,
  formatNaturallyGoodAtAsText,
};
export default NaturallyGoodAtCoaching;
