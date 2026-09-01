import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import IdentityTraitDetailBody from './IdentityTraitDetailBody';

/**
 * Detail popup for a selected identity trait (same shell as career-puzzle piece dialogs).
 */
export default function IdentitySidebar({
  open,
  trait,
  onClose,
  onVote,
  votePending = false,
  voteError = null,
}) {
  const { t } = useTranslation('dashboard');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      PaperProps={{
        sx: {
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pr: 1,
        }}
      >
        <Typography
          component="span"
          variant="h6"
          fontWeight={700}
          sx={{ wordBreak: 'break-word', pr: 1 }}
        >
          {trait?.name || t('careerIdentity.menuLabel')}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label={t('careerIdentity.closeDetail')}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <IdentityTraitDetailBody
          trait={trait}
          onVote={onVote}
          votePending={votePending}
          voteError={voteError}
        />
      </DialogContent>
    </Dialog>
  );
}
