# Dynamic Salary Range Implementation

## What Was Changed

The SimulationResultDetails page has been updated to use dynamic salary ranges from the existing `salary` field in the database instead of hardcoded values.

## Database Structure

The salary data is stored in the `CareerPath` model with the following structure:
```javascript
salary: {
  min: { type: Number },      // Minimum salary
  max: { type: Number },      // Maximum salary  
  currency: { type: String, default: 'EUR' }  // Currency (default: EUR)
}
```

## New Functions Added

### `getSalaryRange(careerStep)`
Determines salary range based on:
1. **Direct salary data**: `careerStep.salaryRange` or `careerStep.salaryMin/salaryMax`
2. **Database salary field**: `careerStep.salary.min/max/currency` (from CareerPath model)
3. **Occupation data**: `careerStep.occupation.salaryRange`
4. **Category-based logic**: Fallback ranges based on role level and category
5. **Default fallback**: €45,000 - €75,000

### `getSalaryRangeDisplay(careerStep)`
Provides user-friendly display text for salary ranges, handling cases where salary information is not applicable.

## Salary Logic

The system now prioritizes the existing `salary` field from the database:

1. **Database salary data**: `careerStep.salary.min/max/currency` (highest priority)
2. **Direct data**: `careerStep.salaryRange` or `careerStep.salaryMin/salaryMax`
3. **Occupation data**: `careerStep.occupation.salaryRange`
4. **Category-based**:
   - Next Steps: €45,000 - €75,000 (senior: €65,000 - €95,000, junior: €35,000 - €55,000)
   - Outside-the-Box: €40,000 - €70,000 (consultant: €50,000 - €90,000)
   - Resources: N/A
5. **Fallback**: €45,000 - €75,000

## Backend Updates

### ESCO Service Enhancement

Added `getSalaryRangeForOccupation()` function in `src/server/services/escoService.js`:

```javascript
function getSalaryRangeForOccupation(escoOccupation) {
  const title = escoOccupation.title.toLowerCase();
  
  if (title.includes('senior') || title.includes('lead') || title.includes('manager') || title.includes('director')) {
    return { min: 65000, max: 95000, currency: 'EUR' };
  } else if (title.includes('junior') || title.includes('entry') || title.includes('assistant')) {
    return { min: 35000, max: 55000, currency: 'EUR' };
  } else if (title.includes('consultant') || title.includes('freelance') || title.includes('contractor')) {
    return { min: 50000, max: 90000, currency: 'EUR' };
  } else if (title.includes('engineer') || title.includes('developer') || title.includes('programmer')) {
    return { min: 45000, max: 75000, currency: 'EUR' };
  } else if (title.includes('analyst') || title.includes('specialist')) {
    return { min: 40000, max: 70000, currency: 'EUR' };
  } else if (title.includes('coordinator') || title.includes('administrator')) {
    return { min: 35000, max: 60000, currency: 'EUR' };
  } else {
    return { min: 45000, max: 75000, currency: 'EUR' };
  }
}
```

### Database Update Script

Created `scripts/updateSalaryData.js` to populate existing career paths with salary data:

```bash
# Run the script to update existing career paths
node scripts/updateSalaryData.js
```

## How to Use

### 1. Update Existing Data

Run the update script to populate existing career paths with salary data:

```bash
node scripts/updateSalaryData.js
```

### 2. New Career Paths

New career paths will automatically get salary data when created through the ESCO service.

### 3. Manual Override

You can manually set salary data for specific career paths:

```javascript
const careerStep = {
  title: "Software Engineer",
  category: "next-steps",
  salary: {
    min: 50000,
    max: 80000,
    currency: "EUR"
  }
};
```

## Testing

### Test Cases

1. **Career steps with database salary data**:
   ```javascript
   const careerStep = {
     title: "Senior Software Engineer",
     category: "next-steps",
     salary: {
       min: 65000,
       max: 95000,
       currency: "EUR"
     }
   };
   // Expected: €65,000 - €95,000
   ```

2. **Career steps without salary data**:
   ```javascript
   const careerStep = {
     title: "Junior Developer",
     category: "next-steps"
   };
   // Expected: €35,000 - €55,000 (based on title)
   ```

3. **Resources (should show N/A)**:
   ```javascript
   const careerStep = {
     title: "Career Development Workshop",
     category: "resources"
   };
   // Expected: N/A
   ```

### Manual Testing

1. Navigate to the Simulation page
2. Run a simulation
3. Click on a career step to view details
4. Verify that the salary range is displayed correctly from the database
5. Test the print functionality
6. Test with different career step categories

## Benefits

- ✅ **Uses existing database structure** - Leverages the existing `salary` field
- ✅ **Automatic population** - New career paths get salary data automatically
- ✅ **Backward compatible** - Existing career steps still work with fallback logic
- ✅ **Flexible currency support** - Supports different currencies (default: EUR)
- ✅ **Smart categorization** - Different ranges for different role levels
- ✅ **Updated print functionality** - Dynamic ranges in printed versions
- ✅ **Extensible** - Easy to add more sophisticated salary logic

## Next Steps

1. **Run the update script** to populate existing career paths with salary data
2. **Test the implementation** with various career step types
3. **Consider external salary APIs** for more accurate real-time data
4. **Add location-based salary ranges** for different cities/regions
5. **Implement experience-based adjustments** for more precise ranges
