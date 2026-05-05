# Profile Picture Management Requirements

This document specifies profile picture behavior (display, upload, crop, delete). The sections below remain the **requirements checklist**; **§2 summarizes what the current codebase implements** so readers are not misled by an outdated “no UI” narrative.

## 1. Purpose

Users should be able to add, replace, crop, and remove their profile picture from the profile experience, with clear feedback and server-backed storage.

## 2. Implementation status (as-built)

| Area | Status | Notes |
|------|--------|--------|
| Avatar on profile header | **Done** | Circular avatar, initial or `PersonIcon` fallback, cache-busting query (`?v=`) via `profilePictureKey` in `Profile.jsx` |
| Add / edit photo entry | **Done** | “Add photo” / “Edit photo” opens `ProfilePictureEditor` |
| Crop / zoom / square preview | **Done** | Implemented in `src/client/components/profile/ProfilePictureEditor.jsx` |
| Upload / delete API | **Done** | Uses `/api/profile/profile-picture` (and related flows as wired in the editor) |
| REQ checklist below | **Reference** | Use §3+ to audit gaps (e.g. mobile gestures, exact copy); treat unchecked or partial items as follow-ups, not as “missing entire feature” |

If implementation drifts from any **REQ-*** item, update either the code or this document.

## 3. Requirements

### 3.1 Core Functionality Requirements

#### 3.1.1 Profile Picture Display
- **REQ-001**: Profile picture must be displayed in a circular avatar at the top of the profile page next to the user's name
- **REQ-002**: If no profile picture exists, display user's first name initial or a default person icon
- **REQ-003**: Profile picture must be responsive and maintain aspect ratio
- **REQ-004**: Profile picture must load efficiently with proper error handling for missing or corrupted images
- **REQ-004a**: Profile picture must update immediately after upload/edit without requiring page refresh
- **REQ-004b**: Image cache-busting must be implemented to ensure updated images are displayed (using query parameter versioning)

#### 3.1.2 Add Profile Picture
- **REQ-005**: Users must be able to add a profile picture by clicking on the avatar or an "Add Photo" button
- **REQ-006**: File selection must support common image formats (JPEG, PNG, GIF, WebP)
- **REQ-007**: File size must be limited to 5MB maximum
- **REQ-008**: Selected image must open in a crop/editor dialog before upload
- **REQ-009**: Users must be able to crop the image to a square aspect ratio
- **REQ-010**: Users must be able to zoom in and zoom out on the image
- **REQ-011**: Users must be able to pan/drag the image within the crop area
- **REQ-012**: Crop area must maintain a square aspect ratio (1:1)
- **REQ-013**: Users must be able to preview the cropped image before saving
- **REQ-014**: Upload must show progress indication during file upload
- **REQ-015**: Success feedback must be provided after successful upload

#### 3.1.3 Edit/Modify Profile Picture
- **REQ-016**: Users must be able to modify their existing profile picture by clicking on the avatar
- **REQ-017**: Clicking on existing profile picture must open the crop/editor dialog with current image
- **REQ-018**: Users must be able to re-crop the existing image
- **REQ-019**: Users must be able to replace the image with a new file
- **REQ-020**: All crop and zoom functionality must be available when editing

#### 3.1.4 Delete Profile Picture
- **REQ-021**: Users must be able to delete their profile picture
- **REQ-022**: Delete action must be accessible from the crop/editor dialog or via a delete button
- **REQ-023**: Delete action must show a confirmation dialog before removing the picture
- **REQ-024**: After deletion, the avatar must revert to showing the user's initial or default icon
- **REQ-025**: Deleted profile picture file must be removed from server storage

### 3.2 Image Editing Requirements

#### 3.2.1 Crop Functionality
- **REQ-026**: Crop tool must allow users to select a square area of the image
- **REQ-027**: Crop area must be resizable by dragging corners or edges
- **REQ-028**: Crop area must maintain 1:1 aspect ratio at all times
- **REQ-029**: Minimum crop size must be enforced (e.g., 200x200 pixels)
- **REQ-030**: Crop area must be visually highlighted with a border or overlay
- **REQ-031**: Users must be able to move the crop area by dragging it

#### 3.2.2 Zoom Functionality
- **REQ-032**: Users must be able to zoom in on the image (up to 3x or 4x magnification)
- **REQ-033**: Users must be able to zoom out on the image (down to fit entire image in crop area)
- **REQ-034**: Zoom controls must be intuitive (slider, buttons, or pinch gesture on mobile)
- **REQ-035**: Zoom must be centered on the crop area when possible
- **REQ-036**: Zoom level must be indicated to users (optional but recommended)

#### 3.2.3 Pan/Drag Functionality
- **REQ-037**: Users must be able to pan/drag the image within the crop area when zoomed in
- **REQ-038**: Pan must be smooth and responsive
- **REQ-039**: Image must be constrained within the crop area boundaries
- **REQ-040**: Pan must work on both desktop (mouse drag) and mobile (touch drag)

#### 3.2.4 Image Preview
- **REQ-041**: Users must see a preview of how the cropped image will appear before saving
- **REQ-042**: Preview must show the circular avatar representation
- **REQ-043**: Preview must update in real-time as crop area changes
- **REQ-044**: Preview must match the final output size and shape

### 3.3 User Interface Requirements

#### 3.3.1 Avatar Display
- **REQ-045**: Avatar must be circular with consistent sizing (96x96 pixels as per current implementation)
- **REQ-046**: Avatar must be positioned at the top of the profile page next to user's name
- **REQ-047**: Avatar must have a hover effect indicating it's clickable
- **REQ-048**: Avatar must show a visual indicator (e.g., camera icon overlay) on hover
- **REQ-049**: Avatar must be accessible via keyboard navigation

#### 3.3.2 Crop/Editor Dialog
- **REQ-050**: Crop/editor must be presented in a modal dialog
- **REQ-051**: Dialog must have a clear title (e.g., "Edit Profile Picture")
- **REQ-052**: Dialog must be responsive and work on mobile devices
- **REQ-053**: Dialog must have clear action buttons (Save, Cancel, Delete)
- **REQ-054**: Dialog must show image dimensions and file size information
- **REQ-055**: Dialog must provide clear instructions for crop and zoom controls

#### 3.3.3 Controls Layout
- **REQ-056**: Crop controls must be intuitive and clearly labeled
- **REQ-057**: Zoom controls must be easily accessible
- **REQ-058**: Action buttons must be prominently displayed
- **REQ-059**: Cancel button must discard changes without saving
- **REQ-060**: Save button must upload and apply the cropped image

#### 3.3.4 Loading and Feedback
- **REQ-061**: Upload progress must be shown during file upload
- **REQ-062**: Success message must be displayed after successful upload
- **REQ-063**: Error messages must be clear and actionable
- **REQ-064**: Loading states must be shown for all async operations
- **REQ-065**: Validation errors must be shown for invalid files or sizes

### 3.4 Technical Requirements

#### 3.4.1 Backend Integration
- **REQ-066**: Must use existing `/api/profile/profile-picture` endpoint for upload
- **REQ-067**: Must support file upload via multipart/form-data
- **REQ-068**: Must handle file size validation (5MB limit)
- **REQ-069**: Must handle file type validation (JPEG, PNG, GIF, WebP)
- **REQ-070**: Must store uploaded files in `uploads/profile-pictures` directory
- **REQ-071**: Must update user profile with profile picture filename
- **REQ-072**: Must delete old profile picture file when replacing or deleting
- **REQ-073**: Must return appropriate error responses for validation failures

#### 3.4.2 Image Processing
- **REQ-074**: Image cropping must be performed client-side before upload
- **REQ-075**: Cropped image must be converted to appropriate format (JPEG recommended)
- **REQ-076**: Final image must be optimized for web (compressed, reasonable file size)
- **REQ-077**: Image must be resized to appropriate dimensions (e.g., 400x400 or 800x800 pixels)
- **REQ-078**: Image processing must maintain quality while reducing file size

#### 3.4.3 Frontend Implementation
- **REQ-079**: Must use React component for crop/editor functionality
- **REQ-080**: Must integrate with Material-UI components and styling
- **REQ-081**: Must use existing file upload patterns (similar to DocumentUploadForm)
- **REQ-082**: Must handle state management for crop area, zoom level, and image data
- **REQ-083**: Must be responsive and work on mobile devices
- **REQ-084**: Must be accessible (keyboard navigation, screen reader support)
- **REQ-085a**: Must implement cache-busting for profile picture images to ensure updates are displayed immediately
- **REQ-085b**: Must update profile state immediately after successful upload to provide instant visual feedback
- **REQ-085c**: Must refresh profile data after upload to ensure state synchronization with server

#### 3.4.4 Image Crop Library
- **REQ-085**: Must use a reliable React image cropping library (e.g., `react-easy-crop`, `react-image-crop`, or `react-cropper`)
- **REQ-086**: Library must support square aspect ratio cropping
- **REQ-087**: Library must support zoom and pan functionality
- **REQ-088**: Library must be well-maintained and compatible with React 18
- **REQ-089**: Library must work with Material-UI components

#### 3.4.5 File Management
- **REQ-090**: Old profile picture files must be deleted from server when replaced
- **REQ-091**: Deleted profile pictures must be removed from server storage
- **REQ-092**: File naming must be unique to prevent conflicts
- **REQ-093**: File paths must be stored correctly in user profile
- **REQ-094**: Static file serving must work correctly for profile pictures

### 3.5 User Experience Requirements

#### 3.5.1 Workflow
- **REQ-095**: Adding profile picture must be a simple 3-step process: Click → Crop → Save
- **REQ-096**: Editing profile picture must allow quick re-cropping or replacement
- **REQ-097**: Deleting profile picture must require confirmation to prevent accidents
- **REQ-098**: All actions must provide clear feedback to users
- **REQ-099**: Workflow must be intuitive and require minimal learning

#### 3.5.2 Error Handling
- **REQ-100**: Invalid file types must show clear error messages
- **REQ-101**: File size errors must suggest solutions (e.g., "File too large, please use an image under 5MB")
- **REQ-102**: Upload failures must be handled gracefully with retry options
- **REQ-103**: Network errors must be clearly communicated
- **REQ-104**: Validation errors must be shown before upload attempt

#### 3.5.3 Accessibility
- **REQ-105**: All interactive elements must be keyboard accessible
- **REQ-106**: Screen reader support must be provided for all controls
- **REQ-107**: Focus management must be handled in modal dialogs
- **REQ-108**: Color contrast must meet WCAG AA standards
- **REQ-109**: Touch targets must meet minimum size requirements (44x44px)

## 4. Affected Components

### 4.1 Frontend Components
1. **Profile Page** (`src/client/components/pages/Profile.jsx`)
   - Add click handler to Avatar component
   - Add profile picture management UI
   - Integrate crop/editor dialog

2. **Profile Picture Editor Component** (New component to be created)
   - Image crop/editor dialog
   - Crop, zoom, and pan controls
   - Preview functionality
   - Upload and delete actions

3. **Avatar Component** (Existing Material-UI Avatar)
   - Add hover effects
   - Add click handler
   - Add visual indicators

### 4.2 Backend Components
1. **Profile Controller** (`src/server/controllers/profileController.js`)
   - `updateProfilePicture` function (already exists, may need enhancement)
   - Add delete profile picture endpoint

2. **Profile Routes** (`src/server/routes/profile.js`)
   - `/api/profile/profile-picture` PUT endpoint (already exists)
   - Add DELETE endpoint for profile picture removal

3. **File Storage**
   - `uploads/profile-pictures` directory (already exists)
   - File deletion logic for old/replaced pictures

### 4.3 Database
1. **User Model** (`src/server/models/User.js`)
   - `profilePicture` field (already exists in `personalInfo`)

## 5. Implementation Guidelines

### 5.1 Image Crop Library Selection

Recommended library: **react-easy-crop** or **react-image-crop**

**react-easy-crop** advantages:
- Simple API and good documentation
- Supports zoom, pan, and crop
- Works well with Material-UI
- Active maintenance
- Good mobile support

**react-image-crop** advantages:
- Lightweight
- Simple API
- Good browser compatibility

### 5.2 Component Structure

```jsx
// ProfilePictureEditor.jsx
<Dialog open={open} onClose={onClose}>
  <DialogTitle>Edit Profile Picture</DialogTitle>
  <DialogContent>
    <Cropper
      image={imageSrc}
      crop={crop}
      zoom={zoom}
      aspect={1}
      onCropChange={setCrop}
      onZoomChange={setZoom}
      onCropComplete={onCropComplete}
    />
    <Box>
      <Slider
        value={zoom}
        min={1}
        max={4}
        step={0.1}
        onChange={(e, value) => setZoom(value)}
      />
      <Typography>Zoom: {zoom.toFixed(1)}x</Typography>
    </Box>
    <Box>
      <Avatar src={croppedImagePreview} sx={{ width: 96, height: 96 }} />
      <Typography variant="caption">Preview</Typography>
    </Box>
  </DialogContent>
  <DialogActions>
    <Button onClick={handleDelete}>Delete</Button>
    <Button onClick={onClose}>Cancel</Button>
    <Button onClick={handleSave} variant="contained">Save</Button>
  </DialogActions>
</Dialog>
```

### 5.3 Upload Flow

1. User clicks on avatar
2. File input dialog opens (or drag-and-drop)
3. User selects image file
4. File is validated (type, size)
5. Image is loaded into crop editor
6. User crops, zooms, and adjusts image
7. User clicks Save
8. Image is cropped and converted to blob
9. Blob is uploaded via FormData to `/api/profile/profile-picture`
10. Server saves file and updates user profile
11. UI updates to show new profile picture
12. Success message is displayed

### 5.4 Delete Flow

1. User clicks on avatar (or delete button in editor)
2. Delete confirmation dialog appears
3. User confirms deletion
4. DELETE request sent to `/api/profile/profile-picture`
5. Server deletes file and updates user profile
6. UI updates to show default avatar
7. Success message is displayed

## 6. Acceptance Criteria

### 6.1 Functional Acceptance Criteria
- [x] Users can click on avatar to add/edit profile picture (`Profile.jsx` opens `ProfilePictureEditor`.)
- [x] File selection supports JPEG, PNG, GIF, WebP formats (`validTypes` in `ProfilePictureEditor.jsx`.)
- [x] File size validation works (5MB limit) (checked before `readAsDataURL`.)
- [x] Image crop tool opens with selected image (`react-easy-crop` + `Cropper`.)
- [x] Users can crop image to square aspect ratio (`aspect={1}` on cropper.)
- [x] Users can zoom in and zoom out on image (`Slider` / zoom controls.)
- [x] Users can pan/drag image within crop area (`crop` / `onCropChange` from `react-easy-crop`.)
- [x] Preview shows circular avatar representation (`Avatar` in dialog preview.)
- [x] Users can save cropped image (`getCroppedImg` → `axios.put` `/api/profile/profile-picture`.)
- [x] Users can delete profile picture with confirmation (`showDeleteConfirm` + server delete.)
- [x] Profile picture displays correctly after upload (`onPictureUpdate` + cache-bust `?v=` on `Profile.jsx`.)
- [x] Old profile picture is deleted when replaced (`profileController` upload deletes previous file.)
- [x] Default avatar shows when no picture exists (initial / `PersonIcon` in `Profile.jsx`.)

### 6.2 UI/UX Acceptance Criteria
- [x] Avatar is circular and properly sized (96x96px) (`Avatar` `width`/`height` 96.)
- [x] Avatar shows hover effect indicating it's clickable (overlay + caption “Add photo” / “Edit photo”.)
- [x] Crop/editor dialog is responsive and works on mobile (MUI `Dialog` + responsive `DialogContent`.)
- [x] Controls are intuitive and clearly labeled (zoom icons, Save/Cancel, tooltips where present.)
- [x] Loading states are shown during upload (`uploading` / `CircularProgress`.)
- [x] Success/error messages are clear and actionable (`Alert` / `setError` messages.)
- [x] Dialog is accessible via keyboard (MUI `Dialog` focus management.)
- [x] Touch targets meet minimum size requirements (MUI `IconButton` / `Button` defaults.)

### 6.3 Technical Acceptance Criteria
- [x] Image cropping is performed client-side (`canvas` via `getCroppedImg` / `imageUtils.js`.)
- [x] Cropped image is optimized before upload (JPEG blob produced client-side before multipart upload.)
- [x] File upload uses existing endpoint (`PUT /api/profile/profile-picture`.)
- [x] Old files are deleted from server storage (`unlinkSync` on replace and delete.)
- [x] Error handling is comprehensive (try/catch + user-facing `error` state.)
- [x] Component is responsive and works on mobile (dialog + stack layout.)
- [x] No memory leaks or performance issues (blob URL cleanup in `useEffect` on close.)
- [x] Code follows existing patterns and conventions (axios, MUI, matches profile patterns.)

## 7. Testing Requirements

### 7.1 Unit Testing
- Test file validation (type, size)
- Test image crop functionality
- Test zoom and pan controls
- Test image conversion and optimization
- Test error handling

### 7.2 Integration Testing
- Test complete upload flow
- Test delete flow
- Test file replacement (old file deletion)
- Test API integration
- Test error scenarios

### 7.3 User Acceptance Testing
- Test on different devices (desktop, tablet, mobile)
- Test with different image formats and sizes
- Test crop, zoom, and pan functionality
- Test accessibility (keyboard, screen reader)
- Test error scenarios from user perspective

## 8. Dependencies and Constraints

### 8.1 Dependencies
- Material-UI components and theming
- React image cropping library (to be selected)
- Existing file upload infrastructure (multer)
- Existing profile API endpoints
- React 18 compatibility

### 8.2 Constraints
- Must work with existing backend infrastructure
- Must maintain 5MB file size limit
- Must support existing image formats
- Must be compatible with current React version
- Must follow existing code patterns and conventions

## 9. Future Considerations

### 9.1 Potential Enhancements
- Multiple image filters/effects
- Image rotation functionality
- Batch image processing
- Image compression options
- Profile picture history/versioning
- Social media integration for profile picture import

### 9.2 Scalability
- Consider cloud storage for profile pictures (AWS S3, Cloudinary)
- Implement CDN for faster image delivery
- Add image optimization service
- Consider image format conversion (WebP support)

## 10. Success Metrics

### 10.1 User Experience Metrics
- Percentage of users with profile pictures
- Time to add/edit profile picture
- User satisfaction with crop/editor tool
- Error rate during upload
- Profile picture quality (user feedback)

### 10.2 Technical Metrics
- Upload success rate
- Average upload time
- File size optimization effectiveness
- Server storage usage
- Error rate and types

