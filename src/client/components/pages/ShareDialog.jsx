import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  IconButton,
  Alert,
  Snackbar,
  Tooltip,
  CircularProgress
} from '@mui/material';
import {
  ContentCopy,
  Close
} from '@mui/icons-material';

const ShareDialog = ({ open, onClose, resultDetails }) => {
  const [shareableLink, setShareableLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    if (open && resultDetails) {
      generateShareableLink();
    }
  }, [open, resultDetails]);

  const normalizeCategory = (category) => {
    const value = String(category || '').trim();
    if (!value) return 'career-role';
    const normalized = value.toLowerCase();
    if (normalized === 'nextsteps' || normalized === 'next-steps') return 'next-steps';
    if (
      normalized === 'outsidethebox' ||
      normalized === 'outside-the-box' ||
      normalized === 'outsideSimulationBox'.toLowerCase()
    ) return 'outside-the-box';
    if (normalized === 'furtheradvice' || normalized === 'resources') return 'resources';
    return normalized;
  };

  const normalizeShareData = (details) => {
    const rawMatchScore =
      details?.matchScore ??
      details?.match_score ??
      details?.hybridScoreNextRole ??
      details?.hybridScoreOutOfTheBox;
    const parsedMatchScore = Number(rawMatchScore);

    return {
      resultId: details?.resultId || details?.stepId || details?.id || `shared-${Date.now()}`,
      title: details?.title || 'Career Step',
      description: details?.description || '',
      category: normalizeCategory(details?.category),
      matchScore: Number.isFinite(parsedMatchScore) ? Math.round(parsedMatchScore) : undefined,
      timestamp: Date.now(),
      seniority: details?.seniority ?? null,
      keyResponsibilities: details?.keyResponsibilities ?? null,
      skillDomains: details?.skillDomains ?? null,
      skillModel: details?.skillModel ?? null,
      altTitles: details?.altTitles ?? null,
      hiddenTitles: details?.hiddenTitles ?? null,
      requiredSkills: details?.requiredSkills ?? null,
      requiredSkillUris: details?.requiredSkillUris ?? null,
      escoId: details?.escoId ?? null
    };
  };

  const encodeSharePayload = (payload) => {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  };

  const generateShareableLink = async () => {
    try {
      setLoading(true);

      const shareData = normalizeShareData(resultDetails);
      const shareId = encodeSharePayload(shareData);
      const baseUrl = window.location.origin;
      const link = `${baseUrl}/shared-result/${shareId}`;

      setShareableLink(link);
    } catch (error) {
      console.error('Error generating shareable link:', error);
      const baseUrl = window.location.origin;
      const fallbackLink = `${baseUrl}/shared-result/${resultDetails.resultId}`;
      setShareableLink(fallbackLink);
      showSnackbar('Share link created. Some details may be simplified.', 'info');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareableLink) {
      showSnackbar('No link available to copy. Please try again.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(shareableLink);
      showSnackbar('Link copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy link:', error);
      showSnackbar('Failed to copy link', 'error');
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Share Career Step
            </Typography>
            <IconButton onClick={onClose} size="small">
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Shareable link
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <TextField
              fullWidth
              value={loading ? 'Generating link…' : shareableLink}
              InputProps={{ readOnly: true }}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.875rem' } }}
            />
            <Tooltip title="Copy link">
              <span>
                <IconButton
                  onClick={handleCopyLink}
                  color="primary"
                  disabled={loading || !shareableLink}
                >
                  {loading ? <CircularProgress size={22} /> : <ContentCopy />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleCopyLink}
            variant="contained"
            disabled={loading || !shareableLink}
            startIcon={loading ? <CircularProgress size={16} /> : <ContentCopy />}
          >
            {loading ? 'Preparing…' : 'Copy link'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ShareDialog;
