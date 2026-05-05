# Career Step Details Consistency Requirements

## Overview

The application has three different contexts for viewing career step details that share consistent functionality and layout while maintaining context-appropriate navigation and actions. All three pages implement a unified design pattern with professional styling and comprehensive functionality. **Role Insights** and enriched skill fields are specified in **`CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md`** and implemented on all three detail components.

## Current Implementation Status ✅ **COMPLETE**

### Three Career Step Details Contexts

#### 1. **Saved Career Steps Context** (`/saved-career-step/:stepId`)
- **Current Component**: `SavedCareerStepDetails.jsx`
- **Context**: Individual saved career step from the Saved Career Steps page
- **Data Source**: sessionStorage or API (`/api/profile/saved-career-steps/:stepId`)
- **Back Navigation**: Smart detection (saved simulation → `/simulation`, otherwise → `/saved-steps`)
- **Status**: ✅ **FULLY IMPLEMENTED** - Matches simulation result page design

#### 2. **Unsaved Simulation Context** (`/simulation/result/:resultId`)
- **Current Component**: `SimulationResultDetails.jsx`
- **Context**: Career step from a new/unsaved simulation result
- **Data Source**: sessionStorage (`currentStepDetails`)
- **Back Navigation**: Back to simulation results
- **Status**: ✅ **FULLY IMPLEMENTED** - Reference implementation

#### 3. **Saved Simulation Context** (`/saved-simulation/:simulationId/career-step/:stepId`)
- **Current Component**: `SavedSimulationCareerStepDetails.jsx`
- **Context**: Career step from a saved simulation
- **Data Source**: API (`/api/profile/simulation/saved/:simulationId`)
- **Back Navigation**: Back to saved simulation (`/simulation/:simulationId`)
- **Status**: ✅ **FULLY IMPLEMENTED** - Matches simulation result page design

## Universal Requirements (All Three Contexts) ✅ **IMPLEMENTED**

### Layout Consistency
1. **Prominent Blue Header Design**
   - `Paper` component with `primary.light` background
   - White text with proper contrast
   - Title with career step name
   - Context information with appropriate labels
   - Creation/save date display
   - Match score with `LinearProgress` bar
   - Action buttons (Save/Unsave, Share, Print) in header

2. **Breadcrumb Navigation**
   - Consistent breadcrumb structure across all pages
   - Context-aware navigation paths
   - Proper link styling and hover states

3. **Context Indicator Chips**
   - "Saved Career Step" (success color)
   - "Simulation Result" (warning color) 
   - "Saved Simulation Career Step" (success color)
   - Consistent chip styling with icons

4. **Two-Column Layout Structure**
   - Main content area (8/12 grid width)
   - Sidebar area (4/12 grid width)
   - Responsive design that stacks on smaller screens

5. **Content Sections (Consistent Order)**
   - **Role Description**: Detailed career step description
   - **Role Insights** *(see `CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md`)*: Seniority, Key Responsibilities, Skill Domains. Only rendered when at least one sub-section has data.
   - **Matched Profile Inputs**: Always visible with chips or fallback message
   - **Role Details**:
     - **Required Skills**: Prefer `skillModel.core_skills` when available; fall back to top-level `requiredSkills`. Show the first **5** skills by default with **Show more/Show less** toggle.
     - **Optional Skills**: Display `skillModel.optional_skills` when available. Show the first **5** by default with **Show more/Show less** toggle. Hidden when data is null/empty.
     - **Also known as**: Show the first **5** alt titles by default with a **Show more/Show less** toggle.
   - **Sidebar Actions**: All primary actions organized in sidebar

### Technical Requirements ✅ **IMPLEMENTED**
1. **Grid Layout**: All sections use `Grid container` with `spacing={3}`
2. **Card Components**: Consistent `Card` and `CardContent` styling
3. **Responsive Design**: 1 column (xs), 2 columns (sm/md), 3 columns (lg+)
4. **Print Support**: Comprehensive print layout with professional formatting
5. **Snackbar Notifications**: Real-time user feedback for all actions
6. **Loading States**: Proper loading indicators for async operations
7. **Error Handling**: Consistent error display and recovery
8. **URL Decoding**: Proper handling of URL-encoded stepIds (`decodeURIComponent`)
9. **Flexible String Matching**: Robust title matching with normalization and fuzzy matching
10. **Data Lookup**: Comprehensive search across all career step categories with fallback mechanisms

## Context-Specific Requirements ✅ **IMPLEMENTED**

### 1. Saved Career Steps Context (`/saved-career-step/:stepId`)
- **Back Button**: Navigate to `/saved-steps` or smart detection
- **Save Action**: "Remove from Saved Steps" (DELETE to unsave)
- **Context Display**: "Saved Career Step • Saved on [date]"
- **Data Handling**: Fetch from API or use sessionStorage fallback
- **Header Stats**: Match Score, Matched Inputs, Category, Saved Date

### 2. Unsaved Simulation Context (`/simulation/result/:resultId`)
- **Back Button**: Navigate to `/simulation` with state handling
- **Save Action**: "Save to Saved Steps" (POST to save) or "Remove from Saved Steps" (DELETE)
- **Context Display**: "Simulation Result • Generated on [date]"
- **Data Handling**: Use sessionStorage data with normalization
- **Header Stats**: Match Score, Matched Inputs, Category, Generated Date

### 3. Saved Simulation Context (`/saved-simulation/:simulationId/career-step/:stepId`)
- **Back Button**: Navigate to `/simulation/:simulationId`
- **Save Action**: "Save to Saved Steps" (if not saved) or "Remove from Saved Steps" (if saved)
- **Context Display**: "Saved Simulation Career Step • From simulation on [date]"
- **Data Handling**: Extract from saved simulation data via API
- **Header Stats**: Match Score, Matched Inputs, Category, Simulation Date

## Data Handling Requirements ✅ **IMPLEMENTED**

### URL Parameter Processing
1. **URL Decoding**: All stepIds from URL parameters must be properly decoded using `decodeURIComponent()`
   - Handles encoded characters like spaces (`%20`), special characters, etc.
   - Example: `technical%20director` → `technical director`

2. **Parameter Validation**: Validate that stepId and simulationId parameters are present and valid
   - Check for null/undefined values
   - Ensure parameters are strings before processing

### Career Step Lookup Logic
1. **Multi-Category Search**: Search across all career step categories in order:
   - `nextSteps` (primary career progression steps)
   - `outsideSimulationBox` (unconventional opportunities)
   - `furtherAdvice` (resources and advice)

2. **Flexible Matching Criteria**: Use multiple matching strategies:
   - **Exact ID Match**: `stepId === decodedStepId || id === decodedStepId`
   - **Title Normalization**: Remove special characters and normalize case
   - **Fuzzy Matching**: Handle variations in spacing, punctuation, and formatting
   - **Partial Matching**: Support substring matching for flexible lookup

3. **String Normalization Function**:
   ```javascript
   const normalizeString = (str) => {
     if (!str) return '';
     return str.toLowerCase().replace(/[^a-z0-9]/g, '');
   };
   ```

4. **Fallback Search**: If primary search fails, search across all categories
   - Ensures no career steps are missed due to categorization issues
   - Provides comprehensive coverage for edge cases

### Error Handling and Debugging
1. **Comprehensive Logging**: Detailed console logging for troubleshooting:
   - Log search parameters and decoded values
   - Log available categories and step counts
   - Log matching attempts and results
   - Log fallback search attempts

2. **Graceful Error Recovery**: Handle missing data scenarios:
   - Display appropriate error messages for missing simulations
   - Provide fallback content when career step data is incomplete
   - Maintain user experience even with data inconsistencies

3. **Data Validation**: Validate data structure and content:
   - Check for required fields (title, description, etc.)
   - Provide default values for missing optional fields
   - Ensure data consistency across different contexts

## Navigation Logic Requirements ✅ **IMPLEMENTED**

### Smart Route Detection
```javascript
const navigateToDetailPage = (context, stepId, simulationId) => {
  switch(context) {
    case 'saved-steps': 
      return `/saved-career-step/${stepId}`;
    case 'simulation': 
      return `/simulation/result/${stepId}`;
    case 'saved-simulation': 
      return `/saved-simulation/${simulationId}/career-step/${stepId}`;
    default: 
      return `/saved-career-step/${stepId}`;
  }
};
```

### Back Button Logic
```javascript
const getBackRoute = (context, simulationId) => {
  switch(context) {
    case 'saved-steps': 
      return { path: '/saved-steps', label: 'Back to Saved Steps' };
    case 'simulation': 
      return { path: '/simulation', label: 'Back to Simulation' };
    case 'saved-simulation': 
      return { path: `/simulation/${simulationId}`, label: 'Back to Simulation' };
    default: 
      return { path: '/saved-steps', label: 'Back to Saved Steps' };
  }
};
```

## Detailed Implementation Specifications ✅ **IMPLEMENTED**

### Header Design Pattern
```jsx
<Paper sx={{ 
  mb: 3,
  backgroundColor: 'primary.light',
  color: 'primary.contrastText',
  borderRadius: 2,
  overflow: 'hidden'
}}>
  <Box sx={{ p: 3 }}>
    {/* Title and Context */}
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 'bold', color: 'white' }}>
          {stepDetails.title}
        </Typography>
        <Typography variant="body1" sx={{ mb: 2, opacity: 0.9 }}>
          {contextInfo}
        </Typography>
      </Box>
      {/* Action Buttons */}
    </Box>
    
    {/* Progress Bar */}
    <LinearProgress variant="determinate" value={matchScore} />
    
    {/* Stats Grid */}
    <Grid container spacing={3}>
      {/* 4-column stats display */}
    </Grid>
  </Box>
</Paper>
```

### Content Section Pattern
```jsx
<Card sx={{ mb: 3 }} className="avoid-break">
  <CardContent>
    <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
      <Icon sx={{ mr: 1, verticalAlign: 'middle' }} />
      Section Title
    </Typography>
    {/* Section content */}
  </CardContent>
</Card>
```

### Sidebar Pattern
```jsx
<Grid item xs={12} lg={4} className="print-sidebar">
  {/* Actions Card */}
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
        <Work sx={{ mr: 1, verticalAlign: 'middle' }} />
        Actions
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Action buttons */}
      </Box>
    </CardContent>
  </Card>
  
  {/* Additional Information Card */}
  <Card className="avoid-break">
    <CardContent>
      {/* Salary range and career insights */}
    </CardContent>
  </Card>
</Grid>
```

## Testing Requirements ✅ **VERIFIED**

### Visual Consistency Tests
- ✅ All three contexts display identical layout structure
- ✅ Prominent blue headers with consistent styling
- ✅ Two-column layout with proper responsive behavior
- ✅ Print layouts are consistent across contexts
- ✅ Responsive breakpoints work identically

### Functional Tests
- ✅ Back buttons navigate to correct pages for each context
- ✅ Save/unsave actions work appropriately per context
- ✅ Data loading works for all three contexts
- ✅ Error handling is consistent with snackbar notifications
- ✅ Loading states display properly

### Navigation Tests
- ✅ Career step cards navigate to correct detail pages based on context
- ✅ Back navigation preserves application state appropriately
- ✅ Breadcrumb navigation works consistently
- ✅ Context indicators display correctly

### Data Handling Tests
- ✅ URL-encoded stepIds are properly decoded (`technical%20director` → `technical director`)
- ✅ Career steps are found across all categories (nextSteps, outsideSimulationBox, furtherAdvice)
- ✅ Flexible string matching handles title variations and formatting differences
- ✅ Fallback search mechanism works when primary search fails
- ✅ Error handling provides appropriate messages for missing data
- ✅ Data validation ensures consistent data structure across contexts

## Acceptance Criteria ✅ **ACHIEVED**

1. **Layout Consistency**: All three career step detail pages look identical except for context-specific information
2. **Navigation Accuracy**: Back buttons and detail page routing work correctly for all contexts
3. **Functionality Parity**: Save, print, share, and other actions work appropriately for each context
4. **Code Maintainability**: Common patterns are followed and components are well-structured
5. **User Experience**: Users can seamlessly navigate between contexts without confusion
6. **Professional Design**: All pages have consistent, modern, professional appearance
7. **Responsive Design**: All pages work perfectly on all screen sizes
8. **Accessibility**: Proper ARIA labels, keyboard navigation, and screen reader support

## Implementation Achievements ✅ **COMPLETED**

### Phase 1: Unified Design Implementation
- ✅ **Prominent Blue Headers**: All pages now use the professional blue header design
- ✅ **Breadcrumb Navigation**: Consistent navigation across all contexts
- ✅ **Context Indicators**: Clear visual indicators for each context type
- ✅ **Two-Column Layout**: Professional layout with main content and sidebar

### Phase 2: Content Standardization
- ✅ **Matched Profile Inputs**: Always visible section with proper fallback handling
- ✅ **Role Details**: Required Skills and “Also known as” with consistent overflow handling
- ✅ **Sidebar Actions**: Organized action buttons with consistent styling

### Phase 3: Enhanced Functionality
- ✅ **Snackbar Notifications**: Real-time user feedback for all actions
- ✅ **Print Optimization**: Professional print layouts across all contexts
- ✅ **Error Handling**: Consistent error display and recovery mechanisms
- ✅ **Loading States**: Proper loading indicators for all async operations

### Phase 4: Technical Excellence
- ✅ **Responsive Design**: Perfect display on all screen sizes
- ✅ **Performance**: Optimized rendering and data handling
- ✅ **Code Quality**: Clean, maintainable, and well-documented code
- ✅ **Accessibility**: Full keyboard navigation and screen reader support

### Phase 5: Data Handling Robustness ✅ **COMPLETED**
- ✅ **URL Decoding**: Fixed URL-encoded stepId handling (`decodeURIComponent`)
- ✅ **Flexible Matching**: Implemented robust string normalization and fuzzy matching
- ✅ **Multi-Category Search**: Enhanced search across all career step categories
- ✅ **Fallback Mechanisms**: Added comprehensive fallback search for edge cases
- ✅ **Error Recovery**: Improved error handling and debugging capabilities
- ✅ **Data Validation**: Enhanced data structure validation and consistency checks

## Future Enhancements

1. **Enriched Field Display**: Display Seniority, Key Responsibilities, Skill Domains, Core Skills, and Optional Skills on all three career step detail pages — see `CAREER_STEP_ENRICHED_FIELDS_DISPLAY_REQUIREMENTS.md`
2. **Advanced Sharing**: Implement comprehensive sharing functionality with social media integration
3. **Export Options**: Add PDF, Word, and other export formats beyond print
4. **Bookmarking**: Allow users to bookmark career steps regardless of context
5. **Analytics**: Track usage patterns across different contexts for optimization insights
6. **Personalization**: Allow users to customize the display and layout preferences
7. **Offline Support**: Implement offline viewing capabilities for saved career steps

## Maintenance Guidelines

### Code Consistency
- All three components follow the same structural patterns
- Common styling is applied consistently across components
- Error handling follows the same patterns
- Loading states use the same components and styling

### Future Updates
- When adding new features, ensure they are implemented across all three contexts
- Maintain the two-column layout structure
- Keep the prominent blue header design consistent
- Preserve the sidebar action organization

### Testing Requirements
- All new features must be tested across all three contexts
- Visual regression testing should verify layout consistency
- Functional testing should ensure context-appropriate behavior
- Performance testing should verify optimal loading times
- Data handling testing should verify URL decoding and flexible matching

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: "Failed to load career step details" Error
**Symptoms**: Error message appears when accessing saved simulation career step detail pages
**Root Causes**:
- URL-encoded stepIds not being decoded properly
- Career step titles not matching due to formatting differences
- Career steps not found in expected categories

**Solutions**:
1. **URL Decoding**: Ensure `decodeURIComponent()` is used on stepId parameters
2. **Flexible Matching**: Use string normalization and fuzzy matching
3. **Multi-Category Search**: Search across all categories (nextSteps, outsideSimulationBox, furtherAdvice)
4. **Fallback Search**: Implement comprehensive fallback mechanisms

#### Issue: Career Steps Not Found in Saved Simulations
**Symptoms**: Career step detail pages show "not found" errors
**Root Causes**:
- Data structure inconsistencies
- Missing or malformed career step data
- Incorrect category assignments

**Solutions**:
1. **Data Validation**: Check for required fields and provide defaults
2. **Comprehensive Logging**: Add detailed console logging for debugging
3. **Error Recovery**: Provide graceful fallbacks for missing data

#### Issue: Inconsistent Data Display
**Symptoms**: Different data structures causing display issues
**Root Causes**:
- Variations in API response formats
- Missing optional fields
- Inconsistent data normalization

**Solutions**:
1. **Data Normalization**: Standardize data structure across contexts
2. **Default Values**: Provide fallback values for missing fields
3. **Type Checking**: Validate data types before processing

### Implementation coverage (as-built; was “debugging checklist”)
- [x] Check browser console for detailed logging output (`SimulationResultDetails.jsx` and related detail pages log lookup and navigation.)
- [x] Verify URL parameters are properly decoded (`decodeURIComponent` on `stepId` in `SavedCareerStepDetails.jsx`, `SavedSimulationCareerStepDetails.jsx`; `resultId` from `useParams` in `SimulationResultDetails.jsx` is route-decoded.)
- [x] Confirm career step exists in simulation data (multi-category lookup + title/fuzzy fallbacks in detail components.)
- [x] Check data structure matches expected format (normalization and optional-field guards before render.)
- [x] Verify API responses contain required fields (fetch paths validate / show errors when data missing.)
- [x] Test with different career step categories (lookup covers `nextSteps`, `outsideSimulationBox`, `furtherAdvice`.)
- [x] Validate error handling and fallback mechanisms (not-found UI, sessionStorage fallbacks, snackbars where applicable.)

---

**Status**: ✅ **FULLY IMPLEMENTED AND VERIFIED**

All three career step detail pages now provide a cohesive, professional user experience with consistent design patterns, comprehensive functionality, and excellent user experience. The implementation exceeds the original requirements and provides a solid foundation for future enhancements.