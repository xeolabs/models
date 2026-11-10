import type { ZodIssue } from 'zod';

/**
 * Describe the field and its constraint without echoing response values, which may
 * include account tokens or signed URLs. Limit the message for large bad responses.
 */
export function providerValidationMessage(issues: ZodIssue[]): string {
  const details = new Set<string>();
  for (const issue of fieldIssues(issues)) {
    details.add(`${fieldPath(issue.path)}: ${reason(issue)}`);
    if (details.size > 10) break;
  }
  return (
    [...details].slice(0, 10).join('; ') + (details.size > 10 ? '; additional errors omitted' : '')
  );
}

/**
 * When an object or array has the right shape, report the fields inside it instead
 * of the less useful failures from alternatives with the wrong outer type.
 */
function* fieldIssues(issues: ZodIssue[]): Generator<ZodIssue> {
  for (const issue of issues) {
    if (issue.code === 'invalid_union') {
      const detailed = issue.unionErrors.filter((error) =>
        error.issues.some((child) => child.path.length > issue.path.length),
      );
      for (const error of detailed.length ? detailed : issue.unionErrors)
        yield* fieldIssues(error.issues);
    } else if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) yield { ...issue, path: [...issue.path, key] };
    } else yield issue;
  }
}

function fieldPath(parts: (string | number)[]): string {
  if (!parts.length) return '(response)';
  return parts
    .map((part, index) => {
      if (typeof part === 'number') return `[${part}]`;
      const name = part.length > 80 ? part.slice(0, 80) + '…' : part;
      return /^[a-zA-Z_$][\w$]*$/.test(name)
        ? (index ? '.' : '') + name
        : `[${JSON.stringify(name)}]`;
    })
    .join('');
}

function reason(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `required field is missing (expected ${issue.expected})`
        : `expected ${issue.expected}, received ${issue.received}`;
    case 'invalid_string':
      return typeof issue.validation === 'string' && issue.validation !== 'regex'
        ? `expected a valid ${issue.validation}`
        : 'string does not match the required format';
    case 'too_small':
    case 'too_big': {
      const boundary = issue.code === 'too_small' ? issue.minimum : issue.maximum;
      const comparison = issue.exact
        ? 'exactly'
        : issue.code === 'too_small'
          ? issue.inclusive
            ? 'at least'
            : 'more than'
          : issue.inclusive
            ? 'at most'
            : 'less than';
      const unit =
        issue.type === 'string'
          ? ' characters'
          : ['array', 'set'].includes(issue.type)
            ? ' items'
            : '';
      return `expected ${comparison} ${boundary}${unit}`;
    }
    case 'invalid_enum_value':
    case 'invalid_union_discriminator':
      return 'expected one of the allowed values';
    case 'invalid_literal':
      return 'does not match the required value';
    case 'unrecognized_keys':
      return 'unexpected field';
    case 'invalid_date':
      return 'expected a valid date';
    case 'not_finite':
      return 'expected a finite number';
    case 'not_multiple_of':
      return `expected a multiple of ${issue.multipleOf}`;
    default:
      return 'does not match the required format';
  }
}
