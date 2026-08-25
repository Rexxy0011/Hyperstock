/**
 * Request validation as middleware, so invalid input is rejected before any
 * controller or Mongoose call sees it.
 *
 * Parsed output replaces the raw input, so downstream code works with typed,
 * whitelisted values — zod strips unknown keys, which is what stops a caller
 * smuggling extra fields into a query or update.
 *
 *   router.post('/', validate({ body: schema }), handler)
 *
 * ZodError is translated to a 400 by the central error handler.
 */
export const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.params) req.params = schemas.params.parse(req.params);
    // req.query has only a getter on some Express versions, so parsed query
    // lands on its own property rather than being assigned back.
    if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
    next();
  } catch (err) {
    next(err);
  }
};
