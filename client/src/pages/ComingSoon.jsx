import Button from '../components/ui/Button';

/** Temporary stand-in so no link on the Landing page is a dead end. */
export default function ComingSoon({ title }) {
  return (
    <div className="mx-auto max-w-300 px-8 py-24 text-center">
      <h1 className="m-0 text-xl font-bold">{title}</h1>
      <p className="mt-4 text-md text-text-muted">This screen is next in the build.</p>
      <div className="mt-8">
        <Button to="/" variant="secondary">
          Back to home
        </Button>
      </div>
    </div>
  );
}
