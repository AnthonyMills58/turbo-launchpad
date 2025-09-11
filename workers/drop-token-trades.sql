-- Drop token_trades table as it's no longer needed
-- All operations now use the unified token_transfers table

DROP TABLE IF EXISTS public.token_trades;
