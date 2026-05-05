# Career Step Display Limit Requirements

## 1. Overview (as-built)

Exploration depth is **capped per category** so users see at most **10** displayed steps in **Next Steps** and **10** in **Outside-the-Box** (20 total), with UI warnings around the configured threshold (see **`src/server/config/displayLimits.js`**: e.g. **WARNING_THRESHOLD** 8, limits **10** per list; overridable via **`NEXT_STEPS_DISPLAY_LIMIT`** / **`OUTSIDE_THE_BOX_DISPLAY_LIMIT`** env vars on the server). The **client** tracks counts and enforces the cap; **server** enforcement on replace differs by endpoint (see §2.3 note below).

**Client vs server limits:** `Simulation.jsx` currently uses **hardcoded** `10` per category for UI caps (`categoryLimits`). If operators change the server defaults via env vars, the **simulation page UI will not automatically pick up** those values unless the client is wired to read the same numbers from an API or build-time config—keep server and client in sync when tuning limits.

## 2. Requirements

### 2.1 Per-Category Display Limit
- **Requirement**: Limit displayed career steps to 10 per category
- **Scope**: Applies independently to "Next Steps" and "Outside-the-Box" categories
- **Total Maximum**: Users can explore up to 20 career steps total (10 per category)
- **Independent Counting**: Each category has its own 10-step limit

### 2.2 Category Independence
- **Next Steps Limit**: Maximum 10 career steps in Next Steps category
- **Outside-the-Box Limit**: Maximum 10 career steps in Outside-the-Box category
- **Independent Operation**: Limits are enforced independently per category
- **No Cross-Category Impact**: Exhausting one category doesn't affect the other

### 2.3 Replacement Logic
- **Sequential Replacement**: When a step is removed, show the next available step from the same category
- **Category Exhaustion**: When a category reaches 10 displayed steps, stop showing new steps from that category
- **Independent Limits**: Each category enforces its own 10-step limit
- **Graceful Degradation**: Handle cases where a category has fewer than 10 available steps

**Current implementation note (important)**
- The **frontend** tracks per-category counts (`categoryDisplayCounts`) and enforces the 10-step cap in the UI.
- The backend currently enforces the limit only on **`POST /api/profile/simulation/:simulationId/replace-career-step/:stepId`** (`replaceCareerStep`).
- The server-side **remove+replace** endpoint (`DELETE /api/profile/simulation-results/:simulationId/career-steps/:stepId`) will append the next item from prioritized lists when available and does **not** currently block replacements at the 10-step cap.

### 2.4 User Interface Updates

#### 2.4.1 Replacement Counter
- **Current**: Shows "X more alternatives available" per category
- **Updated**: Show "X more alternatives available" per category (independent counting)
- **Category-Specific**: Display remaining count for each category separately
- **Limit Warning**: Show warning when approaching the 10-step limit per category

#### 2.4.2 Progress Indicators
- **Category Progress**: Show progress within each category (e.g., "7 of 10 Next Steps shown")
- **Independent Tracking**: Track progress separately for each category
- **Visual Indicators**: Use progress bars or similar visual elements per category

#### 2.4.3 Limit Notifications
- **Approaching Limit**: Show warning when 8+ steps are displayed in a category
- **At Limit**: Show clear message when 10-step limit is reached in a category
- **Category Status**: Show which categories have reached their limits

### 2.5 Backend Changes

#### 2.5.1 Data Structure Updates
- **Per-Category Displayed Counter**: Add fields to track steps displayed per category
- **Category Limits**: Add fields to track per-category display limits (10 per category)
- **Independent Limit Enforcement**: Implement logic to prevent exceeding 10-step limit per category

#### 2.5.2 API Updates
- **Replacement Endpoint**: Update to enforce 10-step limit per category
- **Per-Category Count Tracking**: Track displayed steps per category in database
- **Independent Limit Validation**: Validate requests against 10-step limit per category

### 2.6 Edge Cases

#### 2.6.1 Insufficient Data
- **Less Than 10 Available**: Handle cases where a category has fewer than 10 available steps
- **Single Category**: Handle cases where only one category has alternatives
- **Empty Categories**: Handle cases where a category has no alternatives

#### 2.6.2 User Behavior
- **Rapid Removal**: Handle users who quickly remove multiple steps from one category
- **Category Switching**: Handle users who switch between categories
- **Independent Exploration**: Users can explore each category independently up to its limit
- **Save and Reload**: Maintain per-category limit state across save/reload cycles

## 3. Technical Implementation

### 3.1 Frontend Changes

#### 3.1.1 State Management
```javascript
// Add to simulation state
const [categoryDisplayCounts, setCategoryDisplayCounts] = useState({
  nextSteps: 3,
  outsideTheBox: 3
});
const [categoryLimits] = useState({
  nextSteps: 10,
  outsideTheBox: 10
});
```

#### 3.1.2 Replacement Logic
```javascript
const handleStepReplacement = (category, newStep) => {
  // Check if we can add more steps to this category
  if (categoryDisplayCounts[category] >= categoryLimits[category]) {
    // Show category limit reached message
    return;
  }
  
  // Update category count
  const newCategoryCount = categoryDisplayCounts[category] + 1;
  
  // Check if adding this step would exceed category limit
  if (newCategoryCount > categoryLimits[category]) {
    // Show category limit warning
    return;
  }
  
  // Proceed with replacement
  setCategoryDisplayCounts(prev => ({
    ...prev,
    [category]: newCategoryCount
  }));
};
```

#### 3.1.3 UI Components
- **Enhanced Replacement Counter**: Show per-category counts independently
- **Progress Indicators**: Visual progress bars for each category
- **Category-Specific Warnings**: Clear messaging when approaching or at category limit

### 3.2 Backend Changes

#### 3.2.1 Database Schema Updates
```javascript
// Saved simulations persist per-category tracking on the saved simulation object
// (i.e., items in User.simulationResults[]).
categoryDisplayCounts: {
  nextSteps: { type: Number, default: 3 },
  outsideTheBox: { type: Number, default: 3 }
},
categoryLimits: {
  nextSteps: { type: Number, default: 10 },
  outsideTheBox: { type: Number, default: 10 }
}
```

#### 3.2.2 API Endpoint Updates
```javascript
// POST replace-career-step — controller enforces per-category display limit here
// POST /api/profile/simulation/:simulationId/replace-career-step/:stepId
const replaceCareerStep = async (req, res) => {
  const { simulationId, stepId } = req.params;
  const { category } = req.body;
  
  // Check current counts for this category
  const currentCategoryCount = simulation.categoryDisplayCounts[category];
  const categoryLimit = simulation.categoryLimits[category];
  
  // Enforce per-category limit
  if (currentCategoryCount >= categoryLimit) {
    return res.status(400).json({
      error: `Maximum of ${categoryLimit} career steps can be displayed in ${category} category`
    });
  }
  
  // Proceed with replacement
  // ... existing logic
};
```

### 3.3 Configuration

#### 3.3.1 Configurable Limits
```javascript
const DISPLAY_LIMITS = {
  NEXT_STEPS_LIMIT: 10,
  OUTSIDE_THE_BOX_LIMIT: 10,
  INITIAL_PER_CATEGORY: 3
};
```

#### 3.3.2 Environment Variables
```javascript
// Optional: Make limits configurable per category
const NEXT_STEPS_DISPLAY_LIMIT = process.env.NEXT_STEPS_DISPLAY_LIMIT || 10;
const OUTSIDE_THE_BOX_DISPLAY_LIMIT = process.env.OUTSIDE_THE_BOX_DISPLAY_LIMIT || 10;
```

## 4. User Experience Specifications

### 4.1 Initial State
- **Next Steps**: Show 3 career steps
- **Outside-the-Box**: Show 3 career steps
- **Total**: 6 steps displayed
- **Remaining**: 7 steps available per category (7 Next Steps + 7 Outside-the-Box = 14 total)

### 4.2 During Exploration
- **Step Removal**: User removes a step from Next Steps
- **Replacement**: System shows next available step from Next Steps
- **Counter Update**: "6 more alternatives available" (for Next Steps category)
- **Progress**: "4 of 10 Next Steps shown"

### 4.3 Approaching Category Limit
- **Warning**: When 8+ steps displayed in a category, show "2 steps remaining in [Category]"
- **Visual Cue**: Progress bar shows 80%+ completion for that category
- **Category Info**: Show which categories have remaining alternatives

### 4.4 At Category Limit
- **Message**: "You've explored 10 [Category] career steps. You can still explore [Other Category] alternatives."
- **No More Replacements**: Disable replacement functionality for that category
- **Other Category**: User can continue exploring the other category up to its limit

### 4.5 Both Categories at Limit
- **Message**: "You've explored 20 career steps total (10 per category). Save your simulation to preserve your selections."
- **No More Replacements**: Disable replacement functionality for both categories
- **Save Prompt**: Encourage user to save their current selections

## 5. Acceptance Criteria

### 5.1 Functional Requirements
- ✅ Each category is intended to display a maximum of 10 career steps
- ✅ Replacement counters and progress indicators are per-category
- ✅ Limits are independent per category

**Verified behavior vs. intended behavior**
- ✅ The frontend tracks and enforces the 10-step limit per category in local state.
- ⚠️ Backend enforcement is **partial**: `replaceCareerStep` checks the limit, but **`DELETE …/simulation-results/…/career-steps/…`** does not currently enforce the cap server-side.

### 5.2 User Experience Requirements
- ✅ Clear progress indicators for each category independently
- ✅ Warning messages when approaching category limit
- ✅ Intuitive replacement counter display per category
- ✅ Consistent behavior across all simulation types
- ✅ Proper handling of insufficient data scenarios per category

### 5.3 Technical Requirements
- ✅ Frontend state management tracks limits correctly per category
- ✅ Database schema supports per-category limit tracking for saved simulations
- ✅ Configuration constants exist (`src/server/config/displayLimits.js`)
- ⚠️ Not all API paths validate against per-category limits yet (see note above)

## 6. Implementation Phases

### 6.1 Phase 1: Backend Foundation
- Update database schema for per-category tracking
- Implement per-category limit enforcement in API endpoints
- Add configuration constants for per-category limits
- Update replacement logic for independent category limits

### 6.2 Phase 2: Frontend Integration
- Update state management for per-category limit tracking
- Implement enhanced replacement counter per category
- Add progress indicators per category
- Update UI components for independent category display

### 6.3 Phase 3: User Experience
- Add warning messages per category
- Implement category-specific notifications
- Update UI components for independent category limits
- Add visual progress indicators per category

### 6.4 Phase 4: Testing & Refinement
- Test all edge cases per category
- Validate user experience for independent category limits
- Performance testing for per-category tracking
- Documentation updates

## 7. Success Metrics

### 7.1 User Experience
- **Reduced Overwhelm**: Users report less decision paralysis per category
- **Clear Boundaries**: Users understand exploration limits per category
- **Improved Focus**: Users make decisions within reasonable timeframe per category
- **Consistent Experience**: All users see similar number of alternatives per category

### 7.2 Technical Performance
- **Per-Category Limit Enforcement**: 100% compliance with 10-step limit per category
- **State Consistency**: No discrepancies between frontend and backend per category
- **Error Handling**: Graceful handling of all edge cases per category
- **Performance**: No degradation in simulation performance

## 8. Future Considerations

### 8.1 Configurability
- **Admin Settings**: Allow administrators to adjust limits per category
- **User Preferences**: Allow users to set personal limits per category
- **A/B Testing**: Test different limit values per category

### 8.2 Advanced Features
- **Smart Distribution**: AI-driven category balance
- **Dynamic Limits**: Adjust limits based on user behavior per category
- **Category Prioritization**: User-defined category preferences

### 8.3 Analytics
- **Usage Patterns**: Track how users explore alternatives per category
- **Limit Effectiveness**: Measure impact of limits on user decisions per category
- **Optimization**: Use data to optimize limit values per category

---

**This comprehensive requirements document provides the foundation for implementing a 10-step limit per category for career step display, ensuring users can explore up to 20 career steps total (10 per category) while maintaining a balanced and user-friendly exploration experience.**
