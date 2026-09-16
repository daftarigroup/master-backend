import { z } from 'zod';

const candidateBodySchema = z.object({
  candidateName: z.string().min(1, 'Candidate name is required'),
  dob: z.string().optional().nullable(),
  phoneNo: z.string().min(1, 'Phone number is required'),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  previousCompany: z.string().optional().nullable(),
  experience: z.string().optional().nullable(),
  previousPosition: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  aadharNo: z.string().optional().nullable(),
  lastSalary: z.string().optional().nullable(),
  reasonForLeaving: z.string().optional().nullable(),
  currentAddress: z.string().optional().nullable(),
  indentId: z.union([z.string(), z.number()]).optional().nullable(),
  photo: z.string().optional().nullable(),
  resume: z.string().optional().nullable(),
  status: z.string().optional(),
  notes: z.string().optional().nullable(),
  nextCallDate: z.string().optional().nullable(),
  followUpNotes: z.string().optional().nullable(),
});

export const submitCandidateSchema = z.object({ body: candidateBodySchema });

export const updateCandidateSchema = z.object({ body: candidateBodySchema.partial() });

export const logCallSchema = z.object({
  body: z.object({
    status: z.string().min(1, 'Status is required'),
    notes: z.string().optional(),
  }),
});

const joiningBodySchema = z.object({
  joiningDate: z.string().min(1, 'Joining date is required'),
  employmentType: z.string().optional().nullable(),
  offeredCTC: z.string().min(1, 'Offered CTC is required'),
  monthlySalary: z.number().optional().nullable(),
  probationMonths: z.number().optional().nullable(),
  reportingManager: z.string().optional().nullable(),
  workLocation: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  ifscCode: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  fatherName: z.string().optional().nullable(),
  highestQualification: z.string().optional().nullable(),
  currentAddress: z.string().optional().nullable(),
  aadharAddress: z.string().optional().nullable(),
  aadharNo: z.string().optional().nullable(),
  designationOffered: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  joiningPlace: z.string().optional().nullable(),
  attendanceMode: z.string().optional().nullable(),
  bankBranchName: z.string().optional().nullable(),
  paymentMode: z.string().optional().nullable(),
  emergencyContactRelation: z.string().optional().nullable(),
  emailToBeIssued: z.boolean().optional().nullable(),
  mobileToBeIssued: z.boolean().optional().nullable(),
  laptopToBeIssued: z.boolean().optional().nullable(),
  pfEligible: z.boolean().optional().nullable(),
  esicEligible: z.boolean().optional().nullable(),
  pastPfNo: z.string().optional().nullable(),
  esicNo: z.string().optional().nullable(),
});

export const initializeJoiningSchema = z.object({ body: joiningBodySchema });

export const docVerificationSchema = z.object({
  body: z.object({
    documents: z.record(z.string(), z.any()),
    notes: z.string().optional(),
    complete: z.boolean().optional(),
  }),
});
