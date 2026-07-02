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
  useDebouncedCoachingPersist,
  useCoachingChatAutoScroll,
} from '../../hooks/useCoachingChatAutoScroll';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import IndustrySectorPicker from './IndustrySectorPicker';
import IndustrySectorChip from './IndustrySectorChip';
import { normalizeIndustryDomains } from '../../../constants/industries';

const TOPIC_COUNT = 5;

async function postTopicsIndustriesCoaching({ seniority, messages, lang, token, cvContext }) {
  const res = await fetch(`/api/profile/topics-industries-coaching?${getProfileApiLangQuery()}`, {
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
    const err = new Error(data.details || data.error || 'Coaching request failed');
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

function formatInterestTopicsAsText(interestTopics = []) {
  return interestTopics.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
}

function parseTopicsIndustriesFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { interestTopics: [], industries: [] };
  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  const parseBlock = (block) => block
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  if (blocks.length >= 2) {
    return { interestTopics: parseBlock(blocks[0]), industries: parseBlock(blocks[1]) };
  }
  const lines = parseBlock(raw);
  return { interestTopics: lines.slice(0, TOPIC_COUNT), industries: lines.slice(TOPIC_COUNT) };
}

/** Identity field stores interest topics only; industries live in structuredUserInfo.domains. */
function parseInterestTopicsFromText(text) {
  return parseTopicsIndustriesFromText(text).interestTopics;
}

function formatTopicsIndustriesAsText({ interestTopics = [], industries = [] } = {}) {
  return formatInterestTopicsAsText(interestTopics);
}

/**
 * Summary panel with editable interest topics and industries.
 */
export function TopicsIndustriesSummaryPanel({
  interestTopics = [],
  industries = [],
  onSummaryChange,
  onUserEdited,
  onEditingChange,
  introText,
  showConfirm = false,
  confirmCta,
  onConfirm,
  lang = 'en',
  onRestartChat,
}) {
  const { t } = useTranslation('onboarding');
  const [editing, setEditing] = useState(false);
  const [topicDrafts, setTopicDrafts] = useState([]);
  const [industryDrafts, setIndustryDrafts] = useState([]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const canEdit = typeof onSummaryChange === 'function';

  const startEditing = () => {
    setTopicDrafts(normalizeListDrafts(interestTopics.length > 0 ? interestTopics : [], TOPIC_COUNT));
    setIndustryDrafts(industries.length > 0 ? [...industries] : []);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setTopicDrafts([]);
    setIndustryDrafts([]);
  };

  const saveEditing = () => {
    const cleanedTopics = topicDrafts.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedIndustries = normalizeIndustryDomains(
      industryDrafts.map((item) => String(item || '').trim()).filter(Boolean),
      { keepUnknown: false }
    );
    if (cleanedTopics.length === 0 || cleanedIndustries.length === 0) return;
    onSummaryChange?.({ interestTopics: cleanedTopics, industries: cleanedIndustries });
    onUserEdited?.();
    setEditing(false);
    setTopicDrafts([]);
    setIndustryDrafts([]);
  };

  const renderList = (items, drafts, setDrafts, label, { industries: isIndustries = false } = {}) => {
    if (editing && isIndustries) {
      return (
        <Box sx={{ mb: 2 }}>
          <IndustrySectorPicker
            value={drafts.filter(Boolean)}
            onChange={(nextIndustries) => setDrafts(nextIndustries)}
            lang={lang}
            label={label}
            maxItems={5}
          />
        </Box>
      );
    }

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
    if (isIndustries) {
      return (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
            {label}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {items.map((item, idx) => (
              <IndustrySectorChip key={`${label}-${idx}-${item}`} value={item} lang={lang} />
            ))}
          </Box>
        </Box>
      );
    }
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
          interestTopics,
          topicDrafts,
          setTopicDrafts,
          t('topicsIndustriesCoaching.summary.interestTopicsHeading')
        )}
        {renderList(
          industries,
          industryDrafts,
          setIndustryDrafts,
          t('documentUpload.review.goodAtCategories.domains', { ns: 'onboarding' }),
          { industries: true }
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
            disabled={interestTopics.length === 0 || industries.length === 0}
          >
            {confirmCta}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * LLM-guided chat for topicsIndustriesInterest during manual profile fill.
 */
const TopicsIndustriesCoaching = ({
  seniority,
  onComplete,
  initialInterestTopics = [],
  initialIndustries = [],
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
  const hasInitialSummary = initialInterestTopics.length > 0 || initialIndustries.length > 0;
  const hasInitialChat = initialMessages.length > 0;
  const [phase, setPhase] = useState(hasInitialSummary ? 'summary' : 'chat');
  const [messages, setMessages] = useState(initialMessages);
  const [interestTopics, setInterestTopics] = useState(initialInterestTopics);
  const [industries, setIndustries] = useState(initialIndustries);
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

  useDebouncedCoachingPersist(onChatPersist, {
    phase,
    messages,
    interestTopics,
    industries,
    userEdited,
  });

  const requestNext = useCallback(async (history) => {
    const token = localStorage.getItem('token');
    const data = await postTopicsIndustriesCoaching({
      seniority,
      messages: history,
      lang: coachingLang,
      token,
      cvContext,
    });
    if (data.phase === 'summary') {
      const nextTopics = Array.isArray(data.interestTopics) ? data.interestTopics : [];
      const nextIndustries = Array.isArray(data.industries) ? data.industries : [];
      setInterestTopics(nextTopics);
      setIndustries(nextIndustries);
      setMessages([
        ...history,
        { role: 'assistant', content: data.message?.content || '' },
      ]);
      setPhase('summary');
      return;
    }
    const assistantMessage = data.message?.content?.trim();
    if (!assistantMessage) {
      throw new Error(t('topicsIndustriesCoaching.errors.emptyQuestion'));
    }
    setMessages([...history, { role: 'assistant', content: assistantMessage }]);
  }, [seniority, coachingLang, t, cvContext]);

  requestNextRef.current = requestNext;
  loadFailedMessageRef.current = t('topicsIndustriesCoaching.errors.loadFailed');

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
      setError(err.message || t('topicsIndustriesCoaching.errors.sendFailed'));
      setMessages(messagesRef.current);
      setDraft(answer);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSummary = useCallback(() => {
    const cleanedTopics = interestTopics.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedIndustries = industries.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleanedTopics.length === 0 || cleanedIndustries.length === 0) return;
    const summary = { interestTopics: cleanedTopics, industries: cleanedIndustries };
    onComplete(summary, { userEdited });
  }, [interestTopics, industries, onComplete, userEdited]);

  const handleRestartChat = useCallback(() => {
    bootstrapStartedRef.current = false;
    setPhase('chat');
    setMessages([]);
    setInterestTopics([]);
    setIndustries([]);
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
    const hasSummary = interestTopics.some((item) => String(item || '').trim())
      && industries.some((item) => String(item || '').trim());
    onSummaryFooterStateChange({
      canConfirm: true,
      isEditing: summaryEditing,
      hasSummary,
    });
    return undefined;
  }, [phase, interestTopics, industries, summaryEditing, onSummaryFooterStateChange]);

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
      <TopicsIndustriesSummaryPanel
        interestTopics={interestTopics}
        industries={industries}
        onSummaryChange={({ interestTopics: nextTopics, industries: nextIndustries }) => {
          setInterestTopics(nextTopics);
          setIndustries(nextIndustries);
        }}
        onUserEdited={() => setUserEdited(true)}
        onEditingChange={setSummaryEditing}
        introText={t('topicsIndustriesCoaching.summary.intro')}
        showConfirm={!confirmInFooter}
        confirmCta={t('topicsIndustriesCoaching.summary.confirmCta')}
        onConfirm={handleConfirmSummary}
        lang={coachingLang}
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
              {t('topicsIndustriesCoaching.chat.loading')}
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
              {t('topicsIndustriesCoaching.chat.thinking')}
            </Typography>
          </Box>
        )}
        <Box ref={messagesEndRef} sx={{ height: 0 }} aria-hidden />
      </Box>
      <Box ref={inputAreaRef} sx={coachingChatInputAreaSx}>
        <Divider sx={{ mb: { xs: 0.75, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
        <Box
          sx={{
            display: 'flex',
            gap: { xs: 0.75, sm: 1 },
            alignItems: 'flex-start',
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            minRows={1}
            maxRows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('topicsIndustriesCoaching.chat.inputPlaceholder')}
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
              width: { xs: '100%', sm: 'auto' },
              minHeight: { xs: 40, sm: 'auto' },
            }}
          >
            {t('topicsIndustriesCoaching.chat.sendCta')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export { parseTopicsIndustriesFromText, parseInterestTopicsFromText, formatInterestTopicsAsText, formatTopicsIndustriesAsText };
export default TopicsIndustriesCoaching;
