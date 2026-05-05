import { useState, useEffect, useCallback } from 'react';

// Debounce utility for performance optimization
export const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Field validation rules
export const validationRules = {
  required: (value, fieldName) => {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return `${fieldName} is required.`;
    }
    return null;
  },
  
  minLength: (value, minLength, fieldName) => {
    if (value && value.length < minLength) {
      return `${fieldName} must be at least ${minLength} characters long.`;
    }
    return null;
  },
  
  email: (value, fieldName) => {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return `Please enter a valid email address.`;
    }
    return null;
  },
  
  phone: (value, fieldName) => {
    if (value && !/^\+?[\d\s-]{10,}$/.test(value)) {
      return `Please enter a valid phone number.`;
    }
    return null;
  },
  
  date: (value, fieldName) => {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `Please enter a valid date.`;
    }
    return null;
  },
  
  number: (value, fieldName) => {
    if (value && (isNaN(value) || value < 0)) {
      return `Please enter a valid number.`;
    }
    return null;
  },
  
  enum: (value, options, fieldName) => {
    if (value && !options.includes(value)) {
      return `${fieldName} must be one of: ${options.join(', ')}`;
    }
    return null;
  }
};

// Main validation hook
export const useFieldValidation = (initialData = {}, validationConfig = {}) => {
  const [formData, setFormData] = useState(initialData);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isValid, setIsValid] = useState(false);
  
  // Debounce form data for performance
  const debouncedFormData = useDebounce(formData, 300);

  // Validation function
  const validateField = useCallback((fieldName, value, rules) => {
    if (!rules || rules.length === 0) return null;
    
    for (const rule of rules) {
      const error = rule(value, fieldName);
      if (error) return error;
    }
    return null;
  }, []);

  // Validate all fields
  const validateForm = useCallback(() => {
    const newErrors = {};
    
    Object.keys(validationConfig).forEach(fieldName => {
      const rules = validationConfig[fieldName];
      const value = debouncedFormData[fieldName];
      const error = validateField(fieldName, value, rules);
      if (error) {
        newErrors[fieldName] = error;
      }
    });
    
    setErrors(newErrors);
    setIsValid(Object.keys(newErrors).length === 0);
    return newErrors;
  }, [debouncedFormData, validationConfig, validateField]);

  // Real-time validation effect
  useEffect(() => {
    validateForm();
  }, [validateForm]);

  // Field change handler
  const handleFieldChange = useCallback((fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Mark field as touched
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Field blur handler
  const handleFieldBlur = useCallback((fieldName) => {
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Get field error (show immediately for required fields, otherwise only if touched)
  const getFieldError = useCallback((fieldName) => {
    // For required fields, show errors immediately
    if (validationConfig[fieldName] && validationConfig[fieldName].length > 0) {
      return errors[fieldName] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldName] ? errors[fieldName] : null;
  }, [errors, touched, validationConfig]);

  // Check if field has error
  const hasFieldError = useCallback((fieldName) => {
    return touched[fieldName] && !!errors[fieldName];
  }, [errors, touched]);

  // Reset form
  const resetForm = useCallback((newData = initialData) => {
    setFormData(newData);
    setErrors({});
    setTouched({});
    setIsValid(false);
  }, [initialData]);

  // Update form data
  const updateFormData = useCallback((newData) => {
    setFormData(newData);
  }, []);

  return {
    formData,
    errors,
    touched,
    isValid,
    handleFieldChange,
    handleFieldBlur,
    getFieldError,
    hasFieldError,
    resetForm,
    updateFormData,
    validateForm,
  };
};

// Specific validation configurations for different sections
export const educationValidationConfig = {
  degree: [
    (value) => validationRules.required(value, 'Degree'),
    (value) => validationRules.minLength(value, 2, 'Degree')
  ],
  field: [
    (value) => validationRules.required(value, 'Field of Study'),
    (value) => validationRules.minLength(value, 2, 'Field of Study')
  ],
  institution: [
    (value) => validationRules.required(value, 'Institution'),
    (value) => validationRules.minLength(value, 2, 'Institution')
  ],
  startDate: [
    (value) => validationRules.required(value, 'Start Date'),
    (value) => validationRules.date(value, 'Start Date')
  ],
  graduationYear: [
    (value) => validationRules.required(value, 'Graduation Year'),
    (value) => validationRules.number(value, 'Graduation Year')
  ],
  endDate: [
    (value) => validationRules.date(value, 'End Date')
  ],
  description: [
    // Description is optional, no validation rules
  ]
};

export const certificationValidationConfig = {
  name: [
    (value) => validationRules.required(value, 'Certification Name'),
    (value) => validationRules.minLength(value, 2, 'Certification Name')
  ],
  issuer: [
    (value) => validationRules.required(value, 'Issuer'),
    (value) => validationRules.minLength(value, 2, 'Issuer')
  ],
  date: [
    (value) => validationRules.required(value, 'Issue Date'),
    (value) => validationRules.date(value, 'Issue Date')
  ]
};

export const languageValidationConfig = {
  language: [
    (value) => validationRules.required(value, 'Language'),
    (value) => validationRules.minLength(value, 2, 'Language')
  ],
  proficiency: [
    (value) => validationRules.required(value, 'Proficiency Level'),
    (value) => validationRules.enum(value, ['basic', 'conversational', 'fluent', 'native'], 'Proficiency Level')
  ]
};

export const workExperienceValidationConfig = {
  title: [
    (value) => validationRules.required(value, 'Job Title'),
    (value) => validationRules.minLength(value, 2, 'Job Title')
  ],
  company: [
    (value) => validationRules.required(value, 'Company'),
    (value) => validationRules.minLength(value, 2, 'Company')
  ],
  startDate: [
    (value) => validationRules.required(value, 'Start Date'),
    (value) => validationRules.date(value, 'Start Date')
  ],
  employmentType: [
    (value) => validationRules.required(value, 'Employment Type'),
    (value) => validationRules.enum(value, ['full-time', 'part-time', 'contract', 'freelance', 'internship'], 'Employment Type')
  ],
  location: [
    (value) => validationRules.required(value, 'Location'),
    (value) => validationRules.minLength(value, 2, 'Location')
  ],
  industry: [
    (value) => validationRules.required(value, 'Industry/Sector'),
    (value) => validationRules.minLength(value, 2, 'Industry/Sector')
  ],
  endDate: [
    (value) => validationRules.date(value, 'End Date')
  ],
  description: [
    // Description is optional, no validation rules
  ]
};

// Custom validation hook for work experience arrays
export const useWorkExperienceValidation = (initialData = {}) => {
  const [formData, setFormData] = useState(initialData);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isValid, setIsValid] = useState(false);
  
  // Debounce form data for performance
  const debouncedFormData = useDebounce(formData, 300);

  // Validation function
  const validateField = useCallback((fieldName, value, rules) => {
    if (!rules || rules.length === 0) return null;
    
    for (const rule of rules) {
      const error = rule(value, fieldName);
      if (error) return error;
    }
    return null;
  }, []);

  // Validate work experience entries
  const validateWorkExperience = useCallback((workExperience) => {
    const newErrors = {};
    
    workExperience.forEach((exp, index) => {
      // Validate each field using the work experience validation config
      Object.keys(workExperienceValidationConfig).forEach(fieldName => {
        const rules = workExperienceValidationConfig[fieldName];
        const value = exp[fieldName];
        const error = validateField(fieldName, value, rules);
        if (error) {
          newErrors[`workExperience.${index}.${fieldName}`] = error;
        }
      });
    });
    
    return newErrors;
  }, [validateField]);

  // Validate all fields (current status moved to Seniority section)
  const validateForm = useCallback(() => {
    const newErrors = {};
    
    // Validate work experience entries
    const workExpErrors = validateWorkExperience(debouncedFormData.workExperience || []);
    Object.assign(newErrors, workExpErrors);
    
    setErrors(newErrors);
    setIsValid(Object.keys(newErrors).length === 0);
    return newErrors;
  }, [debouncedFormData, validateWorkExperience]);

  // Real-time validation effect
  useEffect(() => {
    validateForm();
  }, [validateForm]);

  // Field change handler
  const handleFieldChange = useCallback((fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Mark field as touched
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Work experience field change handler
  const handleWorkExperienceChange = useCallback((index, field, value) => {
    setFormData(prev => ({
      ...prev,
      workExperience: prev.workExperience.map((exp, i) => 
        i === index ? { ...exp, [field]: value } : exp
      )
    }));
    
    // Mark field as touched
    const fieldKey = `workExperience.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Field blur handler
  const handleFieldBlur = useCallback((fieldName) => {
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Work experience field blur handler
  const handleWorkExperienceBlur = useCallback((index, field) => {
    const fieldKey = `workExperience.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Get field error (show immediately for required fields, otherwise only if touched)
  const getFieldError = useCallback((fieldName) => {
    return touched[fieldName] ? errors[fieldName] : null;
  }, [errors, touched]);

  // Get work experience field error (show immediately for required fields)
  const getWorkExperienceError = useCallback((index, field) => {
    const fieldKey = `workExperience.${index}.${field}`;
    // For required fields, show errors immediately
    const requiredFields = ['title', 'company', 'startDate', 'employmentType', 'location', 'industry'];
    if (requiredFields.includes(field)) {
      return errors[fieldKey] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldKey] ? errors[fieldKey] : null;
  }, [errors, touched]);

  // Check if field has error
  const hasFieldError = useCallback((fieldName) => {
    return touched[fieldName] && !!errors[fieldName];
  }, [errors, touched]);

  // Check if work experience field has error
  const hasWorkExperienceError = useCallback((index, field) => {
    const fieldKey = `workExperience.${index}.${field}`;
    return touched[fieldKey] && !!errors[fieldKey];
  }, [errors, touched]);

  // Reset form
  const resetForm = useCallback((newData = initialData) => {
    setFormData(newData);
    setErrors({});
    setTouched({});
    setIsValid(false);
  }, [initialData]);

  // Update form data
  const updateFormData = useCallback((newData) => {
    setFormData(newData);
  }, []);

  return {
    formData,
    errors,
    touched,
    isValid,
    handleFieldChange,
    handleFieldBlur,
    handleWorkExperienceChange,
    handleWorkExperienceBlur,
    getFieldError,
    getWorkExperienceError,
    hasFieldError,
    hasWorkExperienceError,
    resetForm,
    updateFormData,
    validateForm,
  };
};

// Custom validation hook for education arrays
export const useEducationValidation = (initialData = {}) => {
  const [formData, setFormData] = useState(initialData);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isValid, setIsValid] = useState(false);
  
  // Debounce form data for performance
  const debouncedFormData = useDebounce(formData, 300);

  // Validation function
  const validateField = useCallback((fieldName, value, rules) => {
    if (!rules || rules.length === 0) return null;
    
    for (const rule of rules) {
      const error = rule(value, fieldName);
      if (error) return error;
    }
    return null;
  }, []);

  // Validate education entries
  const validateEducation = useCallback((education) => {
    const newErrors = {};
    
    education.forEach((edu, index) => {
      // Validate each field using the education validation config
      Object.keys(educationValidationConfig).forEach(fieldName => {
        const rules = educationValidationConfig[fieldName];
        const value = edu[fieldName];
        const error = validateField(fieldName, value, rules);
        if (error) {
          newErrors[`education.${index}.${fieldName}`] = error;
        }
      });
    });
    
    return newErrors;
  }, [validateField]);

  // Validate certifications
  const validateCertifications = useCallback((certifications) => {
    const newErrors = {};
    
    certifications.forEach((cert, index) => {
      Object.keys(certificationValidationConfig).forEach(fieldName => {
        const rules = certificationValidationConfig[fieldName];
        const value = cert[fieldName];
        const error = validateField(fieldName, value, rules);
        if (error) {
          newErrors[`certifications.${index}.${fieldName}`] = error;
        }
      });
    });
    
    return newErrors;
  }, [validateField]);

  // Validate languages
  const validateLanguages = useCallback((languages) => {
    const newErrors = {};
    
    languages.forEach((lang, index) => {
      Object.keys(languageValidationConfig).forEach(fieldName => {
        const rules = languageValidationConfig[fieldName];
        const value = lang[fieldName];
        const error = validateField(fieldName, value, rules);
        if (error) {
          newErrors[`languages.${index}.${fieldName}`] = error;
        }
      });
    });
    
    return newErrors;
  }, [validateField]);

  // Validate all fields
  const validateForm = useCallback(() => {
    const newErrors = {};
    
    // Validate education entries
    const educationErrors = validateEducation(debouncedFormData.education || []);
    Object.assign(newErrors, educationErrors);
    
    // Validate certifications
    const certificationErrors = validateCertifications(debouncedFormData.certifications || []);
    Object.assign(newErrors, certificationErrors);
    
    // Validate languages
    const languageErrors = validateLanguages(debouncedFormData.languages || []);
    Object.assign(newErrors, languageErrors);
    
    setErrors(newErrors);
    setIsValid(Object.keys(newErrors).length === 0);
    return newErrors;
  }, [debouncedFormData, validateEducation, validateCertifications, validateLanguages]);

  // Real-time validation effect
  useEffect(() => {
    validateForm();
  }, [validateForm]);

  // Field change handler
  const handleFieldChange = useCallback((fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Mark field as touched
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Education field change handler
  const handleEducationChange = useCallback((index, field, value) => {
    setFormData(prev => ({
      ...prev,
      education: prev.education.map((edu, i) => 
        i === index ? { ...edu, [field]: value } : edu
      )
    }));
    
    // Mark field as touched
    const fieldKey = `education.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Certification field change handler
  const handleCertificationChange = useCallback((index, field, value) => {
    setFormData(prev => ({
      ...prev,
      certifications: prev.certifications.map((cert, i) => 
        i === index ? { ...cert, [field]: value } : cert
      )
    }));
    
    // Mark field as touched
    const fieldKey = `certifications.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Language field change handler
  const handleLanguageChange = useCallback((index, field, value) => {
    setFormData(prev => ({
      ...prev,
      languages: prev.languages.map((lang, i) => 
        i === index ? { ...lang, [field]: value } : lang
      )
    }));
    
    // Mark field as touched
    const fieldKey = `languages.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Field blur handler
  const handleFieldBlur = useCallback((fieldName) => {
    setTouched(prev => ({
      ...prev,
      [fieldName]: true
    }));
  }, []);

  // Education field blur handler
  const handleEducationBlur = useCallback((index, field) => {
    const fieldKey = `education.${index}.${field}`;
    setTouched(prev => ({
      ...prev,
      [fieldKey]: true
    }));
  }, []);

  // Get field error (show immediately for required fields)
  const getFieldError = useCallback((fieldName) => {
    return errors[fieldName] || null;
  }, [errors]);

  // Get education field error (show immediately for required fields)
  const getEducationError = useCallback((index, field) => {
    const fieldKey = `education.${index}.${field}`;
    // For required fields, show errors immediately
    const requiredFields = ['degree', 'institution', 'field', 'startDate', 'graduationYear'];
    if (requiredFields.includes(field)) {
      return errors[fieldKey] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldKey] ? errors[fieldKey] : null;
  }, [errors, touched]);

  // Get certification field error
  const getCertificationError = useCallback((index, field) => {
    const fieldKey = `certifications.${index}.${field}`;
    // For required fields, show errors immediately
    const requiredFields = ['name', 'issuer', 'date'];
    if (requiredFields.includes(field)) {
      return errors[fieldKey] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldKey] ? errors[fieldKey] : null;
  }, [errors, touched]);

  // Get language field error
  const getLanguageError = useCallback((index, field) => {
    const fieldKey = `languages.${index}.${field}`;
    // For required fields, show errors immediately
    const requiredFields = ['language', 'proficiency'];
    if (requiredFields.includes(field)) {
      return errors[fieldKey] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldKey] ? errors[fieldKey] : null;
  }, [errors, touched]);

  // Check if field has error
  const hasFieldError = useCallback((fieldName) => {
    return !!errors[fieldName];
  }, [errors]);

  // Check if education field has error
  const hasEducationError = useCallback((index, field) => {
    const fieldKey = `education.${index}.${field}`;
    return !!errors[fieldKey];
  }, [errors]);

  // Reset form
  const resetForm = useCallback((newData = initialData) => {
    setFormData(newData);
    setErrors({});
    setTouched({});
    setIsValid(false);
  }, [initialData]);

  // Update form data
  const updateFormData = useCallback((newData) => {
    setFormData(newData);
  }, []);

  return {
    formData,
    errors,
    touched,
    isValid,
    handleFieldChange,
    handleFieldBlur,
    handleEducationChange,
    handleEducationBlur,
    handleCertificationChange,
    handleLanguageChange,
    getFieldError,
    getEducationError,
    getCertificationError,
    getLanguageError,
    hasFieldError,
    hasEducationError,
    resetForm,
    updateFormData,
    validateForm,
  };
};

// Simplified validation hook for individual work experience entries
export const useWorkExperienceEntryValidation = (entryData = {}, entryIndex = 0) => {
  const {
    formData,
    errors,
    touched,
    isValid,
    handleFieldChange,
    handleFieldBlur,
    getFieldError,
    hasFieldError,
    resetForm,
    updateFormData,
    validateForm,
  } = useFieldValidation(entryData, workExperienceValidationConfig);

  // Transform errors to use simple keys for this entry
  const transformedErrors = {};
  Object.keys(errors).forEach(key => {
    transformedErrors[`entry${entryIndex}_${key}`] = errors[key];
  });

  // Transform touched state to use simple keys
  const transformedTouched = {};
  Object.keys(touched).forEach(key => {
    transformedTouched[`entry${entryIndex}_${key}`] = touched[key];
  });

  // Override getFieldError to show errors immediately for required fields
  const getFieldErrorOverride = useCallback((fieldName) => {
    // For required fields, show errors immediately
    const requiredFields = ['title', 'company', 'startDate', 'employmentType', 'location', 'industry'];
    if (requiredFields.includes(fieldName)) {
      return errors[fieldName] || null;
    }
    // For optional fields, only show if touched
    return touched[fieldName] ? errors[fieldName] : null;
  }, [errors, touched]);

  return {
    formData,
    errors: transformedErrors,
    touched: transformedTouched,
    isValid,
    handleFieldChange,
    handleFieldBlur,
    getFieldError: getFieldErrorOverride,
    hasFieldError,
    resetForm,
    updateFormData,
    validateForm,
  };
};

export default {
  useFieldValidation,
  useWorkExperienceValidation,
  useWorkExperienceEntryValidation,
  useEducationValidation,
  useDebounce,
  validationRules,
  workExperienceValidationConfig,
  educationValidationConfig,
  certificationValidationConfig,
  languageValidationConfig,
};
