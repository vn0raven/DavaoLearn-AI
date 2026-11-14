export type Skill = 'phonics' | 'oral' | 'comprehension';
export type Mark = 'CORRECT' | 'INCORRECT';
export type Preliminary = 'LIKELY_CORRECT' | 'LIKELY_INCORRECT' | 'UNCERTAIN';
export interface Form { formId: string; difficultyTier: string; version?: string; items: {itemId: string; word: string}[] }
export interface Passage {formId: string; passageId: string; title: string; text: string; difficultyTier: string; version: string }
export interface Question { questionId: string; prompt: string; choices: {answerId: string; text: string}[] }
export interface ComprehensionForm {formId: string; passageId: string; title: string; text: string; questions: Question[]; difficultyTier: string; version: string}
export interface Provisional {status: string; message?: string; score?: number; transcript?: string; items: {word?: string; questionId?: string; answerId?: string; correct?: boolean; heard?: string; verdict?: Preliminary}[]}
export interface Validated { event: {eventId: string; learnerId: string; skill: Skill; correct: number; total: number; assisted: boolean; timestamp: string; difficultyTier: string}; marks: Mark[]; selectedTakes: number[]; validatedAt: string; note: string }
export interface Submission {id: string; learner: string; session: string; skill: Skill; form: string; created_at: string; status: 'validated' | 'awaiting_teacher_review'; provisional: Provisional | null; result: Validated | null; assisted: boolean}
export interface Slot { prompt: number; take: number; mime: string; digest: string }
export interface SkillState {skill: Skill; status: 'SUPPORT' | 'READY' | 'UNCONFIRMED'; latestUsableScore: number | null; reason: string; reassess: boolean; history: {eventId: string; score: number|null; disposition: string}[] }
export interface Activity {activityId: string; label: string; description?: string; purpose?: string; skill?: Skill | null; difficultyTier?: string | null }
export interface Profile {learnerId: string; selectedTiers?: Partial<Record<Skill,string>>; skills: SkillState[]; activeGaps: Skill[]; reassessmentQueue: Skill[]; events: Array<{eventId:string;skill:Skill;correct:number;total:number;timestamp:string}>; overrides: Array<{overrideId:string;why:string;timestamp:string}>; recommendation: {primary?: Activity; secondary?: Activity; explanation: string; pendingRechecks: Skill[]; activeGaps: Skill[]; teacherOverride?: unknown}}
