# Dynamic Salary Range Implementation

## Overview

The SimulationResultDetails page has been updated to support dynamic salary ranges instead of hardcoded values. This document explains the implementation and how to extend it further.

## Current Implementation

### 1. Dynamic Salary Range Functions

Two new functions have been added to `SimulationResultDetails.jsx`:

#### `getSalaryRange(careerStep)`
This function determines the appropriate salary range based on:
- Direct salary data in the career step object
- Occupation-specific salary information
- Role level and category-based logic
- Fallback to default ranges

#### `getSalaryRangeDisplay(careerStep)`
This function provides user-friendly display text for the salary range, handling cases where salary information is not applicable.

### 2. Salary Range Logic

The system uses the following hierarchy to determine salary ranges:

1. **Direct salary data**: `careerStep.salaryRange` or `careerStep.salaryMin/salaryMax`
2. **Occupation data**: `careerStep.occupation.salaryRange`
3. **Category-based logic**:
   - **Next Steps**: 
     - Senior/Lead/Manager roles: €65,000 - €95,000
     - Junior/Entry roles: €35,000 - €55,000
     - Default: €45,000 - €75,000
   - **Outside-the-Box**:
     - Consultant/Freelance: €50,000 - €90,000
     - Default: €40,000 - €70,000
   - **Resources**: N/A (not applicable)
4. **Fallback**: €45,000 - €75,000

## How to Extend the System

### Option 1: Add Salary Data to Career Step Generation

Update the backend to include salary data when generating career steps:

```javascript
// In your career step generation service
function generateCareerStep(occupation, category) {
  return {
    title: occupation.title,
    description: occupation.description,
    category: category,
    salaryRange: getSalaryRangeForOccupation(occupation, category),
    // or separate min/max values
    salaryMin: 45000,
    salaryMax: 75000,
    // ... other fields
  };
}

function getSalaryRangeForOccupation(occupation, category) {
  // Implement your salary logic here
  // You could use external APIs, databases, or predefined ranges
  const baseSalary = getBaseSalaryForOccupation(occupation);
  const categoryMultiplier = getCategoryMultiplier(category);
  
  return {
    min: Math.round(baseSalary * categoryMultiplier.min),
    max: Math.round(baseSalary * categoryMultiplier.max)
  };
}
```

### Option 2: Use External Salary APIs

Integrate with salary data providers:

```javascript
// Example integration with a salary API
async function fetchSalaryData(occupationTitle, location = 'Germany') {
  try {
    const response = await fetch(`https://api.salary-provider.com/salary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobTitle: occupationTitle,
        location: location,
        experience: 'mid-level'
      })
    });
    
    const data = await response.json();
    return {
      salaryMin: data.salary_25th_percentile,
      salaryMax: data.salary_75th_percentile,
      currency: 'EUR'
    };
  } catch (error) {
    console.error('Failed to fetch salary data:', error);
    return null;
  }
}
```

### Option 3: Database-Driven Salary Ranges

Create a salary ranges collection in your database:

```javascript
// MongoDB Schema for Salary Ranges
const salaryRangeSchema = new mongoose.Schema({
  occupationTitle: String,
  category: String,
  experienceLevel: String,
  location: String,
  salaryMin: Number,
  salaryMax: Number,
  currency: String,
  lastUpdated: Date
});

// Usage in career step generation
async function getSalaryRangeFromDB(occupationTitle, category) {
  const salaryData = await SalaryRange.findOne({
    occupationTitle: { $regex: occupationTitle, $options: 'i' },
    category: category
  });
  
  return salaryData ? {
    salaryMin: salaryData.salaryMin,
    salaryMax: salaryData.salaryMax,
    currency: salaryData.currency
  } : null;
}
```

### Option 4: Update ESCO Service

Extend the existing ESCO service to include salary data:

```javascript
// In src/server/services/escoService.js
function mapOccupationToCareerPath(escoOccupation) {
  return {
    escoId: escoOccupation.uri || escoOccupation.id,
    title: escoOccupation.title,
    description: escoOccupation.description,
    requiredSkills: [],
    education: [],
    salary: {
      range: getSalaryRangeForESCOOccupation(escoOccupation),
      currency: 'EUR',
      location: 'Germany'
    },
    trends: '',
  };
}

function getSalaryRangeForESCOOccupation(escoOccupation) {
  // Implement salary logic based on ESCO occupation data
  // You could use the occupation title, ISCO code, or other metadata
  const title = escoOccupation.title.toLowerCase();
  
  if (title.includes('senior') || title.includes('lead')) {
    return { min: 65000, max: 95000 };
  } else if (title.includes('junior') || title.includes('entry')) {
    return { min: 35000, max: 55000 };
  } else {
    return { min: 45000, max: 75000 };
  }
}
```

## Testing the Implementation

### Test Cases

1. **Career steps with direct salary data**:
   ```javascript
   const careerStep = {
     title: "Senior Software Engineer",
     category: "next-steps",
     salaryRange: "€70,000 - €100,000"
   };
   ```

2. **Career steps with separate min/max values**:
   ```javascript
   const careerStep = {
     title: "Junior Developer",
     category: "next-steps",
     salaryMin: 40000,
     salaryMax: 60000
   };
   ```

3. **Resources (should show N/A)**:
   ```javascript
   const careerStep = {
     title: "Career Development Workshop",
     category: "resources"
   };
   ```

### Manual Testing

1. Navigate to the Simulation page
2. Run a simulation
3. Click on a career step to view details
4. Verify that the salary range is displayed correctly
5. Test the print functionality
6. Test with different career step categories

## Future Enhancements

### 1. Location-Based Salary Ranges

```javascript
function getSalaryRangeByLocation(occupation, location) {
  const locationMultipliers = {
    'Berlin': 1.0,
    'Munich': 1.15,
    'Hamburg': 0.95,
    'Frankfurt': 1.1,
    'Cologne': 0.9
  };
  
  const baseRange = getBaseSalaryRange(occupation);
  const multiplier = locationMultipliers[location] || 1.0;
  
  return {
    min: Math.round(baseRange.min * multiplier),
    max: Math.round(baseRange.max * multiplier)
  };
}
```

### 2. Experience-Based Adjustments

```javascript
function getSalaryRangeByExperience(occupation, experienceYears) {
  const baseRange = getBaseSalaryRange(occupation);
  const experienceMultiplier = Math.min(1 + (experienceYears * 0.1), 1.5);
  
  return {
    min: Math.round(baseRange.min * experienceMultiplier),
    max: Math.round(baseRange.max * experienceMultiplier)
  };
}
```

### 3. Industry-Specific Ranges

```javascript
function getSalaryRangeByIndustry(occupation, industry) {
  const industryMultipliers = {
    'Technology': 1.2,
    'Finance': 1.3,
    'Healthcare': 1.1,
    'Education': 0.8,
    'Manufacturing': 0.9
  };
  
  const baseRange = getBaseSalaryRange(occupation);
  const multiplier = industryMultipliers[industry] || 1.0;
  
  return {
    min: Math.round(baseRange.min * multiplier),
    max: Math.round(baseRange.max * multiplier)
  };
}
```

## Conclusion

The dynamic salary range system is now implemented and ready for use. The system provides:

- ✅ Dynamic salary ranges based on career step data
- ✅ Fallback logic for missing data
- ✅ Category-specific salary ranges
- ✅ Support for resources (N/A display)
- ✅ Updated print functionality
- ✅ Extensible architecture for future enhancements

To fully implement this system, you'll need to:

1. Update your career step generation logic to include salary data
2. Optionally integrate with external salary APIs
3. Create a salary ranges database if needed
4. Test the implementation with various career step types

The system is designed to be backward compatible, so existing career steps without salary data will still display appropriate ranges based on the fallback logic.
