import {
  Bug,
  Bot,
  Users,
  Shield,
  GitPullRequest,
  GitMerge,
  GitBranch,
  GitCommit,
  Play,
  Mail,
  Lock,
  Moon,
  CheckCircle2,
  PencilLine,
  TestTube,
  FolderSearch,
  MessageSquare,
  Sparkles,
  Upload,
  type LucideProps,
} from "lucide-react";

const REGISTRY = {
  bug: Bug,
  bot: Bot,
  users: Users,
  shield: Shield,
  "git-pull-request": GitPullRequest,
  "git-merge": GitMerge,
  "git-branch": GitBranch,
  "git-commit": GitCommit,
  play: Play,
  mail: Mail,
  lock: Lock,
  moon: Moon,
  "check-circle-2": CheckCircle2,
  "pencil-line": PencilLine,
  "test-tube": TestTube,
  "folder-search": FolderSearch,
  "message-square": MessageSquare,
  sparkles: Sparkles,
  upload: Upload,
} as const;

export type LucideIconName = keyof typeof REGISTRY;

type LucideIconProps = { name: LucideIconName } & LucideProps;

export function LucideIcon({ name, ...rest }: LucideIconProps) {
  const Icon = REGISTRY[name];
  return <Icon {...rest} />;
}
